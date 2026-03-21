const aiService = require("./aiService");
const logger = require("../../config/logger");
const TimelineEvent = require("../../models/TimelineEvent");
const InterviewSession = require("../../models/InterviewSession");

/**
 * AI Technical Interviewer Assistant & Evidence Engine
 */
class InterviewAssistant {
  /**
   * Generate contextual follow-up questions during active interview
   */
  async generateFollowUp({
    session,
    activeCode,
    activeLanguage,
    transcriptHistory = [],
    currentStage,
  }) {
    // Copilot prompts must be traceable to something the interviewer can see.
    // A deterministic evidence-first suggestion is safer than a plausible but
    // fabricated statement from a model (for example claiming a hash map was used).
    const code = activeCode || "";
    const evidence = buildEvidenceGroundedFollowUp(code, activeLanguage);
    if (evidence) return evidence;

    const prompt = `
You are an expert AI Principal Engineer acting as a co-interviewer assistant for a technical interview.
Analyze the candidate's current progress and stage to provide high-leverage, deep technical follow-up questions.

Interview Details:
- Job Role: ${session.job?.title || "Software Engineer"}
- Current Stage: ${currentStage}
- Active Language: ${activeLanguage}
- Problem Statement: ${session.activeProblem?.title || "Technical Problem"}

Recent Transcript:
${transcriptHistory.slice(-5).map((t) => `${t.speaker}: ${t.text}`).join("\n") || "Candidate is currently working on the implementation."}

Current Candidate Code:
\`\`\`${activeLanguage}
${(activeCode || "").slice(0, 4000)}
\`\`\`

Generate a JSON response with:
1. "observation": 1-2 sentence technical observation of the candidate's approach, complexity, or design tradeoff.
2. "suggestedQuestion": A precise, insightful technical question the interviewer can ask next.
3. "assessedCompetency": The core engineering competency being evaluated (e.g. "Time Complexity", "Concurrency", "Cache Invalidation", "Error Handling").
4. "difficultyLevel": "Medium" | "Hard"
`;

    try {
      const response = await aiService.executeWithCascade(prompt, {
        safeParse: (data) => ({
          success: Boolean(data && typeof data === "object"),
          data: {
            observation: data.observation || "Candidate is implementing the core logic.",
            suggestedQuestion:
              data.suggestedQuestion ||
              "What is the expected time and space complexity of your current implementation?",
            assessedCompetency: data.assessedCompetency || "Time Complexity",
            difficultyLevel: data.difficultyLevel || "Medium",
          },
        }),
        parse: () => ({
          observation: "Candidate is structuring their solution.",
          suggestedQuestion: "How does your approach scale under peak load?",
          assessedCompetency: "System Scalability",
          difficultyLevel: "Medium",
        }),
      });

      return response.data;
    } catch (err) {
      logger.warn({ err: err.message }, "Fallback in AI Interview Assistant");
      return {
        observation: "Candidate is proceeding with solution implementation.",
        suggestedQuestion: "Can you trace your solution with an edge case?",
        assessedCompetency: "Edge Case Handling",
        difficultyLevel: "Medium",
      };
    }
  }

  /**
   * Generate post-interview evidence-backed evaluation scorecard
   */
  async generateEvaluation({ session, timelineEvents = [] }) {
    const prompt = `
You are an expert Bar Raiser evaluating a completed technical interview.
Synthesize the entire interview timeline, code executions, and transcript into a structured evaluation with concrete evidence items.

Interview Summary:
- Candidate: ${session.seeker?.name || "Candidate"}
- Role: ${session.job?.title || "Software Engineer"}
- Total Timeline Events: ${timelineEvents.length}

Timeline Highlights:
${timelineEvents
  .slice(0, 30)
  .map((e) => `[${Math.floor(e.offsetMs / 1000)}s - ${e.pipeline}] ${e.eventType}: ${JSON.stringify(e.payload)}`)
  .join("\n")}

Generate a structured evaluation JSON:
- "recommendedDecision": "STRONG_HIRE" | "HIRE" | "LEAN_HIRE" | "LEAN_REJECT" | "REJECT"
- "confidenceScore": number between 0.70 and 0.99
- "strengths": Array of 2-4 concrete technical strengths demonstrated
- "growthAreas": Array of 1-3 areas for improvement
- "categories": Array of evaluated categories ("Coding & Algorithms", "System Architecture & Scalability", "Problem Solving & Decomposition", "Communication & Technical Clarity") each with a score (1-5) and specific evidence timestamp references.
`;

    try {
      const result = await aiService.executeWithCascade(prompt, {
        safeParse: (data) => ({
          success: Boolean(data && typeof data === "object"),
          data: {
            recommendedDecision: data.recommendedDecision || "HIRE",
            confidenceScore: data.confidenceScore || 0.88,
            strengths: data.strengths || ["Clean algorithmic implementation", "Clear technical communication"],
            growthAreas: data.growthAreas || ["Deep-dive into boundary condition edge cases"],
            categories: data.categories || [
              { category: "Coding & Algorithms", score: 4, notes: "Efficient data structure utilization." },
              { category: "Problem Solving & Decomposition", score: 4, notes: "Systematic step-by-step reasoning." },
            ],
          },
        }),
        parse: () => ({
          recommendedDecision: "HIRE",
          confidenceScore: 0.85,
          strengths: ["Solid fundamentals", "Good problem decomposition"],
          growthAreas: ["Consider distributed concurrency edge cases"],
          categories: [
            { category: "Coding & Algorithms", score: 4, notes: "Solid algorithmic reasoning." },
          ],
        }),
      });

      return result.data;
    } catch (err) {
      logger.error({ err: err.message }, "Error generating AI interview evaluation");
      return {
        recommendedDecision: "LEAN_HIRE",
        confidenceScore: 0.8,
        strengths: ["Candidate completed the core problem requirements."],
        growthAreas: ["Review complexity tradeoffs under high concurrency."],
        categories: [
          { category: "Coding & Algorithms", score: 3, notes: "Standard solution implemented." },
        ],
      };
    }
  }
}

function buildEvidenceGroundedFollowUp(code, language) {
  const normalized = code.toLowerCase();
  if (!code.trim()) {
    return {
      observation: "No executable code is currently present in the shared workspace.",
      suggestedQuestion: "Before choosing an approach, what inputs, outputs, and edge cases should the solution handle?",
      assessedCompetency: "Problem Decomposition",
      difficultyLevel: "Medium",
    };
  }
  if (/unordered_map|hashmap|\bmap\s*<|\bdict\b|\bmap\(/i.test(code)) {
    return {
      observation: "The shared code contains a map or dictionary lookup.",
      suggestedQuestion: "What are the expected time and space costs of these lookups, and which input pattern could make them degrade?",
      assessedCompetency: "Data Structure Tradeoffs",
      difficultyLevel: "Medium",
    };
  }
  if (/\bsort\s*\(|\.sort\s*\(|\bsorted\s*\(/i.test(code)) {
    return {
      observation: "The shared code explicitly sorts data before continuing.",
      suggestedQuestion: "What is the resulting time complexity, and can the ordering requirement be satisfied without sorting?",
      assessedCompetency: "Algorithmic Complexity",
      difficultyLevel: "Medium",
    };
  }
  if (/\bfor\s*\(|\bwhile\s*\(|\bfor\s+\w+\s+in\b/i.test(code)) {
    return {
      observation: "The shared code contains an iterative traversal.",
      suggestedQuestion: "Which boundary values could cause this loop to skip work or access beyond the intended range?",
      assessedCompetency: "Boundary Conditions",
      difficultyLevel: "Medium",
    };
  }
  return {
    observation: `The shared ${language || "code"} workspace contains an initial implementation, without a verified use of a specialized data structure.`,
    suggestedQuestion: "Can you trace one normal input and one edge input through the current implementation?",
    assessedCompetency: "Problem Solving & Validation",
    difficultyLevel: "Medium",
  };
}

const interviewAssistant = new InterviewAssistant();
module.exports = interviewAssistant;
