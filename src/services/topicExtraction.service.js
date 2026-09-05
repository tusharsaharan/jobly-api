/**
 * Topic Extraction Service
 *
 * Converts freeform interviewer feedback, candidate weaknesses, or growth areas
 * into canonical topic weaknesses using Gemini with rule-based fallback.
 */

const CandidateTopicWeakness = require("../models/CandidateTopicWeakness");
const { TOPIC_TAXONOMY, matchTopicsFromText, getTopicNames } = require("../constants/topicTaxonomy");
const ragService = require("./rag.service");
const logger = require("../config/logger");

/**
 * Extract structured topics from text using LLM, with deterministic fallback.
 * @param {string} rawText
 * @returns {Promise<Array<{topic: string, confidence: number}>>}
 */
async function extractTopics(rawText) {
  if (!rawText || rawText.trim().length < 3) return [];

  const canonicalTopics = getTopicNames();

  // Try LLM primary
  if (process.env.GEMINI_API_KEY) {
    try {
      const prompt = `
You are an expert technical evaluation analyzer.
Analyze the following interview feedback notes/weaknesses and extract all computer science / programming topics where the candidate needs improvement.

Map every identified weakness STRICTLY to one of these canonical topics:
${JSON.stringify(canonicalTopics)}

Feedback Text:
"${rawText}"

Return strictly a JSON array of objects with schema:
[
  { "topic": "Canonical Topic Name", "confidence": 0.85 }
]
Only return topics from the canonical list. Confidence must be between 0.0 and 1.0. If no specific topic weakness is mentioned, return [].
`;

      const { generateWithFallback } = require("../modules/ai/providers/geminiClient");
      const responseText = await generateWithFallback(process.env.GEMINI_API_KEY, {
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });

      let text = responseText.trim();
      if (text.startsWith("```")) {
        text = text.replace(/^```(json)?\n/, "").replace(/\n```$/, "");
      }

      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        // Validate against canonical taxonomy
        return parsed.filter(item => item.topic && TOPIC_TAXONOMY[item.topic] && item.confidence >= 0.5);
      }
    } catch (err) {
      logger.warn({ err: err.message }, "LLM topic extraction failed, using rule-based fallback");
    }
  }

  // Rule-based fallback using taxonomy aliases
  return matchTopicsFromText(rawText);
}

/**
 * Process feedback and persist CandidateTopicWeakness records for a candidate.
 *
 * @param {object} params
 * @param {string} params.candidateId
 * @param {string} params.sourceType - "evaluation" | "interview_note" | "scorecard"
 * @param {string} params.sourceId
 * @param {string} params.sourceSessionId
 * @param {string|string[]} params.feedback - Text or array of strings
 */
async function processCandidateFeedback({ candidateId, sourceType, sourceId, sourceSessionId, feedback }) {
  if (!candidateId || !feedback) return [];

  const rawText = Array.isArray(feedback) ? feedback.join(".\n") : String(feedback);
  if (!rawText.trim()) return [];

  const extracted = await extractTopics(rawText);
  if (!extracted || extracted.length === 0) return [];

  const savedWeaknesses = [];

  for (const item of extracted) {
    const topicInfo = TOPIC_TAXONOMY[item.topic] || { category: "CS_FUNDAMENTALS" };

    // Precise & extensive: RAG (topK 8) + curated topic links (always) — so card is never thin
    let cachedResources = [];
    try {
      const chunks = await ragService.retrieve(item.topic, {
        namespace: "study_resource",
        topK: 8,
      });

      const ragMapped = chunks
        .filter(c => c.sourceUrl)
        .map(c => {
          const s = typeof c.score === "number" ? c.score : 0;
          const confidence = s > 0.55 ? "high" : s > 0.30 ? "medium" : s > 0.15 ? "low" : "none";
          return {
            title: c.sourceTitle || c.topic || item.topic,
            url: c.sourceUrl,
            description: c.content?.slice(0, 220) || "",
            type: "rag",
            score: c.score,
            confidence,
            relevancePct: Math.round(Math.min(0.98, s) * 100),
            retrievedAt: new Date()
          };
        });

      // Curated, categorized external links for this canonical topic — precise, always extensive
      const { buildTopicStudyLinks } = require("../utils/search.utils");
      const curated = buildTopicStudyLinks(item.topic, topicInfo.category).map(l => ({
        ...l,
        description: l.description?.slice(0, 220) || "",
        retrievedAt: new Date(),
      }));

      // Merge: RAG first (precise), then curated (extensive), dedupe by url, keep top 10
      const seen = new Set();
      const merged = [];
      for (const r of [...ragMapped, ...curated]) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        merged.push(r);
        if (merged.length >= 10) break;
      }
      cachedResources = merged;
    } catch (err) {
      logger.warn({ err: err.message, topic: item.topic }, "Failed to retrieve resources for weakness");
      // Fallback to curated only so recommendation is never empty
      try {
        const { buildTopicStudyLinks } = require("../utils/search.utils");
        cachedResources = buildTopicStudyLinks(item.topic, topicInfo.category).slice(0, 6).map(l => ({ ...l, retrievedAt: new Date() }));
      } catch {}
    }

    try {
      const weaknessDoc = await CandidateTopicWeakness.findOneAndUpdate(
        {
          candidate: candidateId,
          topic: item.topic,
          sourceId: sourceId
        },
        {
          $setOnInsert: {
            candidate: candidateId,
            topic: item.topic,
            category: topicInfo.category,
            confidence: item.confidence || 0.8,
            sourceType,
            sourceId,
            sourceSession: sourceSessionId || null,
            rawText: rawText.slice(0, 1000),
            resolved: false,
            cachedResources: cachedResources
          }
        },
        { upsert: true, new: true }
      );

      if (weaknessDoc) savedWeaknesses.push(weaknessDoc);
    } catch (err) {
      logger.error({ err: err.message, topic: item.topic }, "Error saving CandidateTopicWeakness");
    }
  }

  logger.info({ candidateId, count: savedWeaknesses.length }, "Extracted and saved candidate topic weaknesses");
  return savedWeaknesses;
}

module.exports = {
  extractTopics,
  processCandidateFeedback,
};
