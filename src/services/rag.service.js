/**
 * RAG Service — Retrieval-Augmented Generation Infrastructure
 *
 * Provides:
 *   1. embed(text)            — convert text to a 3072-dim vector via Gemini
 *   2. ingestChunks(chunks)   — embed and store chunks into EmbeddingChunk collection
 *   3. retrieve(query, opts)  — vector search with optional namespace/scope filtering
 *   4. ragAnswer(query, chunks, opts) — generate an LLM answer grounded in retrieved chunks
 *
 * Supports both:
 *   - Global retrieval:    retrieve("OS scheduling", { namespace: "study_resource" })
 *   - Blog-scoped retrieval: retrieve("what is CAP", { namespace: "blog_content", scopeId: "articleId" })
 */

const { GoogleGenAI } = require("@google/genai");
const EmbeddingChunk = require("../models/EmbeddingChunk");
const logger = require("../config/logger");

// ── Constants ────────────────────────────────────────────────────

const EMBEDDING_MODEL = "gemini-embedding-001";  // 3072-dim, available on v1beta
const EMBEDDING_DIM = 3072;
const GENERATION_MODEL = "gemini-flash-lite-latest";

// ── Lazy-init AI client ─────────────────────────────────────────

let _ai = null;
function getAI() {
  if (!_ai) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _ai;
}

// ── Embedding ───────────────────────────────────────────────────

/**
 * Convert a text string into a 3072-dimensional embedding vector.
 * Uses Gemini gemini-embedding-001.
 * @param {string} text
 * @returns {Promise<number[]>} float[3072]
 */
async function embed(text) {
  const result = await getAI().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  return result.embeddings[0].values;
}

// ── Ingestion ───────────────────────────────────────────────────

/**
 * Embed and store an array of content chunks.
 *
 * @param {Array<{
 *   content: string,
 *   namespace: "study_resource"|"blog_content"|"problem_metadata",
 *   scopeId?: string,
 *   sourceType?: string,
 *   sourceUrl?: string,
 *   sourceTitle?: string,
 *   topic?: string
 * }>} chunks
 * @returns {Promise<number>} Number of chunks inserted
 */
async function ingestChunks(chunks) {
  const BATCH_SIZE = 20; // stay under Gemini rate limits
  let inserted = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    // Embed all content in the batch
    const embeddings = await Promise.all(batch.map((c) => embed(c.content)));

    const docs = batch.map((c, j) => ({
      content:     c.content,
      embedding:   embeddings[j],
      namespace:   c.namespace,
      scopeId:     c.scopeId || null,
      sourceType:  c.sourceType || null,
      sourceUrl:   c.sourceUrl || null,
      sourceTitle: c.sourceTitle || null,
      topic:       c.topic || null,
    }));

    await EmbeddingChunk.insertMany(docs);
    inserted += docs.length;

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  logger.info({ inserted }, "RAG ingestion complete");
  return inserted;
}

// ── Retrieval ───────────────────────────────────────────────────

/**
 * Perform a vector similarity search.
 * Falls back to text-based search if embedding or Atlas Vector Search fails.
 *
 * @param {string} query            The user query
 * @param {object} opts
 * @param {"study_resource"|"blog_content"|"problem_metadata"} opts.namespace  Required
 * @param {string} [opts.scopeId]   For blog-scoped retrieval
 * @param {string} [opts.topic]     Optional topic filter
 * @param {number} [opts.topK=5]    How many results to return
 * @returns {Promise<Array<{content, sourceUrl, sourceTitle, topic, score}>>}
 */
async function retrieve(query, { namespace, scopeId = null, topic = null, topK = 5 }) {
  // Build filter for Atlas Vector Search
  const filter = {};
  if (namespace) filter.namespace = namespace;
  if (scopeId)   filter.scopeId = scopeId;
  if (topic)     filter.topic = topic;

  try {
    // Attempt embedding + vector search
    const queryEmbedding = await embed(query);

    const results = await EmbeddingChunk.aggregate([
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: topK * 10,
          limit: topK,
          filter: filter,
        },
      },
      {
        $project: {
          content: 1,
          sourceUrl: 1,
          sourceTitle: 1,
          topic: 1,
          namespace: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ]);

    if (results && results.length > 0) return results;

    // If vector search returned nothing, fall through to text search
    logger.info("Vector search returned 0 results, falling back to text search");
  } catch (err) {
    // Embedding or Atlas Vector Search failed — fall back gracefully
    logger.warn({ err: err.message }, "Vector retrieval failed, falling back to text search");
  }

  // Fallback: keyword-based text search
  return fallbackTextSearch(query, { namespace, scopeId, topic, topK });
}

const STOP_WORDS = new Set([
  "what", "is", "are", "how", "does", "do", "did", "why", "when", "where", "which", "who", "whom",
  "teach", "tell", "explain", "describe", "give", "show", "help", "with", "about",
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "from", "by",
  "can", "you", "me", "my", "i", "we", "our", "it", "its", "this", "that", "these", "those"
]);

function stringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.85;

  const bigrams = (str) => {
    const s = new Set();
    for (let i = 0; i < str.length - 1; i++) {
      s.add(str.slice(i, i + 2));
    }
    return s;
  };
  const b1 = bigrams(s1);
  const b2 = bigrams(s2);
  let intersection = 0;
  for (const bg of b1) {
    if (b2.has(bg)) intersection++;
  }
  return (2.0 * intersection) / (b1.size + b2.size || 1);
}

/**
 * Fallback text search when Atlas Vector Search index is unavailable.
 * Uses smart keyword extraction, typo tolerance, and multi-field relevance scoring.
 */
async function fallbackTextSearch(query, { namespace, scopeId, topic, topK }) {
  const filter = {};
  if (namespace) filter.namespace = namespace;
  if (scopeId)   filter.scopeId = scopeId;
  if (topic)     filter.topic = topic;

  // Clean and extract meaningful keywords
  const cleaned = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  const keywords = rawTokens.filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const searchTokens = keywords.length > 0 ? keywords : rawTokens.filter((w) => w.length > 2);

  // Fetch candidate documents
  const allDocs = await EmbeddingChunk.find(filter)
    .select("content sourceUrl sourceTitle topic")
    .lean();

  if (allDocs.length === 0) return [];

  // If no search tokens available, return top N
  if (searchTokens.length === 0) {
    return allDocs.slice(0, topK).map((r) => ({ ...r, score: 0.5 }));
  }

  // Score each document based on topic, title, and content match (with fuzzy typo tolerance)
  const scored = [];
  for (const doc of allDocs) {
    let score = 0;
    const lowerContent = (doc.content || "").toLowerCase();
    const lowerTitle = (doc.sourceTitle || "").toLowerCase();
    const lowerTopic = (doc.topic || "").toLowerCase();

    let matchedTokens = 0;
    for (const token of searchTokens) {
      let tokenHit = false;

      // Exact substring matching
      if (lowerTopic.includes(token)) {
        score += 0.6;
        tokenHit = true;
      }
      if (lowerTitle.includes(token)) {
        score += 0.5;
        tokenHit = true;
      }
      if (lowerContent.includes(token)) {
        score += 0.3;
        tokenHit = true;
      }

      // Fuzzy matching for typos (e.g. "spotoify" -> "spotify", "netflx" -> "netflix")
      if (!tokenHit && token.length >= 4) {
        const titleWords = lowerTitle.split(/[^a-z0-9]/).filter((w) => w.length >= 3);
        const topicWords = lowerTopic.split(/[^a-z0-9]/).filter((w) => w.length >= 3);

        for (const tw of titleWords) {
          const sim = stringSimilarity(token, tw);
          if (sim >= 0.65) {
            score += 0.5 * sim;
            tokenHit = true;
            break;
          }
        }

        if (!tokenHit) {
          for (const topw of topicWords) {
            const sim = stringSimilarity(token, topw);
            if (sim >= 0.65) {
              score += 0.55 * sim;
              tokenHit = true;
              break;
            }
          }
        }
      }

      if (tokenHit) matchedTokens++;
    }

    // Boost documents that matched a higher percentage of search terms
    const coverageRatio = matchedTokens / searchTokens.length;
    score = score * (0.5 + 0.5 * coverageRatio);

    if (score > 0.1) {
      scored.push({
        ...doc,
        score: Math.min(0.98, parseFloat(score.toFixed(3))),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ── Generation (RAG completion) ─────────────────────────────────

const MIN_CONFIDENCE_SCORE = 0.1; // Allows all relevant retrieved chunks to be answered

/**
 * Generate an LLM answer grounded in retrieved chunks.
 *
 * @param {string} query              The user question
 * @param {Array}  retrievedChunks    Output from retrieve()
 * @param {object} [opts]
 * @param {string} [opts.systemPrompt]  Extra system-level instruction
 * @returns {Promise<{reply: string, sources: Array, confidence: string}>}
 */
async function ragAnswer(query, retrievedChunks, { systemPrompt = "" } = {}) {
  // No results or all scores too low → graceful fallback
  if (
    !retrievedChunks ||
    retrievedChunks.length === 0 ||
    (retrievedChunks[0]?.score !== undefined && retrievedChunks[0].score < MIN_CONFIDENCE_SCORE)
  ) {
    return {
      reply:
        "I could not find directly relevant curriculum material for this specific query in the local knowledge base. " +
        "Please check your keywords or explore our comprehensive System Design Problem Sheets and Landmark Papers.",
      sources: [],
      confidence: "none",
    };
  }

  // Structured context injection
  const contextBlock = retrievedChunks
    .map(
      (c, i) =>
        `[Source ${i + 1}: "${c.sourceTitle || "Unknown"}" — ${c.sourceUrl || "No URL"}]\n${c.content}`
    )
    .join("\n\n---\n\n");

  const defaultOraclePrompt =
    "You are the authoritative Jobly System Design & Technical Architecture Oracle — an elite Principal Distributed Systems Architect. " +
    "Synthesize an exhaustive, beautifully formatted, production-grade system design answer to the user's question, strictly grounded in computer science fundamentals and the curriculum reference material provided below. " +
    "Present a structured breakdown including: \n" +
    "1) **System Overview & Requirements** (Functional & Non-Functional: Latency, Availability, Consistency, Scale).\n" +
    "2) **Capacity Estimation** (Traffic QPS, Storage & Bandwidth estimates).\n" +
    "3) **High-Level Architecture & Core Components** (Client, Edge/CDN, API Gateway, Microservices, Caching Layer, Databases, Blob Storage, Message Queues).\n" +
    "4) **Data Model & Database Architecture** (SQL vs NoSQL vs In-Memory, Sharding keys).\n" +
    "5) **Deep-Dive Engineering Mechanics** (Domain-specific pipelines such as audio/video chunking, geospatial indexing, fanout, or consensus algorithms).\n" +
    "6) **Reliability, Fault Tolerance & Caching Strategies**.\n" +
    "Always cite the verified reference materials using [Source N].";

  const prompt = `${systemPrompt ? systemPrompt + "\n\n" : defaultOraclePrompt + "\n\n"}Reference Material:
${contextBlock}

User Question: ${query}

Instructions:
- Provide an in-depth, structured, clear technical response.
- Reference the sources with [Source 1], [Source 2], etc.
- If referencing URLs, use the verified source URLs from the reference material above.`;

  const response = await getAI().models.generateContent({
    model: GENERATION_MODEL,
    contents: prompt,
  });

  const topScore = retrievedChunks[0]?.score;

  return {
    reply: response.text,
    sources: retrievedChunks.map((c) => ({
      title: c.sourceTitle,
      url: c.sourceUrl,
      score: c.score,
    })),
    confidence: topScore > 0.7 ? "high" : topScore > 0.4 ? "medium" : "low",
  };
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = {
  embed,
  ingestChunks,
  retrieve,
  ragAnswer,
  EMBEDDING_DIM,
};
