const aiService = require("./aiService");
const logger = require("../../config/logger");
const TimelineEvent = require("../../models/TimelineEvent");
const InterviewSession = require("../../models/InterviewSession");
const { extractAllSignals } = require("../signals/signalExtractor");
const { createEvidenceReference } = require("../signals/evidenceEngine");
const { scoreInterviewSession } = require("../signals/rubricScorer");

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
- Job Role: ${session?.job?.title || "Software Engineer"}
- Current Stage: ${currentStage || "CODING"}
- Active Language: ${activeLanguage || "javascript"}
- Problem Statement: ${session?.activeProblem?.title || "Technical Problem"}

Recent Transcript:
${transcriptHistory.slice(-5).map((t) => `${t.speaker}: ${t.text}`).join("\n") || "Candidate is currently working on the implementation."}

Current Candidate Code:
\`\`\`${activeLanguage || "javascript"}
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
    const sessionId = String(session?._id || "session-default");
    const candidateId = String(session?.seeker?._id || session?.seeker || "candidate-default");
    const interviewerId = String(session?.recruiter?._id || session?.recruiter || "recruiter-default");

    // Extract real multi-modal signals from timeline
    const codeEvents = timelineEvents.filter((e) => e.pipeline === "CODING");
    const execEvents = timelineEvents.filter((e) => e.eventType?.startsWith("execution.") || e.eventType === "code.run" || e.eventType === "code.test");
    const transcriptEvents = timelineEvents.filter((e) => e.pipeline === "COMMUNICATION" || e.eventType === "transcript.segment");
    const whiteboardEvents = timelineEvents.filter((e) => e.pipeline === "WHITEBOARD");
    const focusEvents = timelineEvents.filter((e) => e.pipeline === "SYSTEM" && e.eventType?.startsWith("focus."));

    const latestCode = codeEvents[codeEvents.length - 1]?.payload?.code || "";
    const lastExec = execEvents[execEvents.length - 1]?.payload || {};

    const signals = extractAllSignals({
      sessionId,
      code: latestCode,
      language: session?.config?.language || "javascript",
      executionResult: lastExec,
      testCaseResults: lastExec?.results || [],
      transcriptSegments: transcriptEvents.map((t) => ({
        text: t.payload?.text || "",
        participantId: t.participant,
        participantRole: t.participantRole,
      })),
      candidateId,
      whiteboardData: whiteboardEvents[whiteboardEvents.length - 1]?.payload || {},
      focusEvents,
    });

    // Create evidence references from top events
    const evidenceReferences = [];
    for (const ev of timelineEvents.slice(0, 15)) {
      try {
        const ref = createEvidenceReference({
          type: ev.pipeline === "CODING" ? "CODE_CHECKPOINT" : ev.pipeline === "COMMUNICATION" ? "TRANSCRIPT" : ev.pipeline === "WHITEBOARD" ? "WHITEBOARD_SNAPSHOT" : "TIMELINE_EVENT",
          timelineEventId: ev._id || `ev-auto-${ev.offsetMs}`,
          offsetMs: ev.offsetMs || 0,
          locator: {
            file: ev.payload?.file || undefined,
            quote: ev.payload?.text || undefined,
            speaker: ev.participantRole || "Candidate",
          },
          summary: `${ev.pipeline} event: ${ev.eventType}`,
        });
        evidenceReferences.push(ref);
      } catch (e) {
        // Skip invalid synthetic events
      }
    }

    // Run deterministic rubric scoring
    const deterministicEvaluation = scoreInterviewSession({
      signals,
      evidenceReferences,
      sessionId,
      candidateId,
      interviewerId,
    });

    return deterministicEvaluation;
  }
}

function buildEvidenceGroundedFollowUp(code, language) {
  // Do not treat a problem description, comment, or string literal as proof
  // that the candidate used a data structure.
  const executableCode = String(code)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/#.*$/gm, "")
    .replace(/(['"]).*?\1/g, "");
  if (!code.trim()) {
    return {
      observation: "No executable code is currently present in the shared workspace.",
      suggestedQuestion: "Before choosing an approach, what inputs, outputs, and edge cases should the solution handle?",
      assessedCompetency: "Problem Decomposition",
      difficultyLevel: "Medium",
    };
  }
  if (/\bstd::unordered_map\s*<|\bunordered_map\s*<|\bHashMap\s*(?:<|\()|\b(?:collections\.)?defaultdict\s*\(|\{\s*[^{}]+\s*:\s*[^{}]+\}/i.test(executableCode)) {
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
