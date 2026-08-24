const crypto = require("crypto");
const logger = require("../../config/logger");

/**
 * Strips comments and string literals to analyze clean executable code
 */
function cleanExecutableCode(code, language = "javascript") {
  if (!code || typeof code !== "string") return "";
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/#.*$/gm, "")
    .replace(/(['"`])(?:\\.|[^\\])*?\1/g, "");
}

/**
 * Calculate approximate loop nesting depth from clean code
 */
function calculateLoopNesting(code) {
  if (!code) return 0;
  const lines = code.split("\n");
  let currentDepth = 0;
  let maxDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/\b(for|while)\s*\(|\bfor\s+\w+\s+in\b/i.test(trimmed)) {
      currentDepth++;
      if (currentDepth > maxDepth) maxDepth = currentDepth;
    }
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;
    if (closeBraces > openBraces && currentDepth > 0) {
      currentDepth = Math.max(0, currentDepth - (closeBraces - openBraces));
    }
  }

  return maxDepth;
}

/**
 * 1. Extract Code AST & Structural Signals
 */
function extractCodeSignals({ code = "", language = "javascript", activeFile = "/solution.py", offsetMs = 0, sessionId = "session-default" }) {
  const signals = [];
  const clean = cleanExecutableCode(code, language);
  const now = new Date().toISOString();

  if (!clean.trim()) {
    signals.push({
      id: `sig-code-empty-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "empty_workspace",
      indicator: "neutral",
      weight: 1.0,
      offsetMs,
      payload: { activeFile, lineCount: 0 },
      createdAt: now,
    });
    return signals;
  }

  // A. Data Structure Detections
  // Hash Maps / Dictionaries
  if (/\b(?:Map|HashMap|std::unordered_map|unordered_map|dict|defaultdict)\b|\{\s*["'\w]+\s*:\s*[^}]+\}/i.test(clean)) {
    signals.push({
      id: `sig-code-hashmap-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "data_structure_hash_map",
      indicator: "positive",
      weight: 2.0,
      offsetMs,
      payload: {
        pattern: "Hash Map / Dictionary",
        description: "Utilized constant-time average lookup data structure (O(1) lookups).",
      },
      createdAt: now,
    });
  }

  // Sets
  if (/\b(?:Set|HashSet|std::unordered_set|unordered_set|set)\s*(?:<|\(|\b)/i.test(clean)) {
    signals.push({
      id: `sig-code-set-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "data_structure_set",
      indicator: "positive",
      weight: 1.5,
      offsetMs,
      payload: { pattern: "Set", description: "Utilized unique set for membership verification." },
      createdAt: now,
    });
  }

  // Stacks / Queues / Deques / Heaps
  if (/\b(?:PriorityQueue|min_heap|max_heap|heapq|deque|Queue|Stack)\b/i.test(clean)) {
    signals.push({
      id: `sig-code-heapqueue-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "data_structure_heap_queue",
      indicator: "positive",
      weight: 2.5,
      offsetMs,
      payload: { pattern: "Heap / Queue / Deque", description: "Applied advanced linear/priority data structure." },
      createdAt: now,
    });
  }

  // Dynamic Programming / Memoization
  if (/\b(?:dp\s*=\s*\[|memo\s*=\s*\{\}|@lru_cache|memoization|table\[)/i.test(clean)) {
    signals.push({
      id: `sig-code-dp-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "algorithmic_dynamic_programming",
      indicator: "positive",
      weight: 3.0,
      offsetMs,
      payload: { pattern: "Dynamic Programming / Memoization", description: "Implemented subproblem caching strategy." },
      createdAt: now,
    });
  }

  // Sorting
  if (/\b(?:sort|sorted|std::sort)\s*\(/i.test(clean)) {
    signals.push({
      id: `sig-code-sort-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "algorithmic_sorting",
      indicator: "neutral",
      weight: 1.0,
      offsetMs,
      payload: { pattern: "Explicit Sorting", description: "Applied O(N log N) sorting transformation." },
      createdAt: now,
    });
  }

  // Binary Search
  if (/\b(?:low\s*<=\s*high|left\s*<=\s*right|mid\s*=\s*(?:low|left|\(low|\(left))\b/i.test(clean)) {
    signals.push({
      id: `sig-code-binsearch-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "algorithmic_binary_search",
      indicator: "positive",
      weight: 2.5,
      offsetMs,
      payload: { pattern: "Binary Search", description: "Implemented logarithmic O(log N) search boundaries." },
      createdAt: now,
    });
  }

  // Two Pointers / Sliding Window
  if (/\b(?:window_start|window_end|left\s*<\s*right|start\s*<\s*end)\b/i.test(clean)) {
    signals.push({
      id: `sig-code-twopointer-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "algorithmic_two_pointers",
      indicator: "positive",
      weight: 2.0,
      offsetMs,
      payload: { pattern: "Two Pointers / Sliding Window", description: "Linear traversal with boundary pointers." },
      createdAt: now,
    });
  }

  // B. Complexity & Nesting Analysis
  const nestingDepth = calculateLoopNesting(clean);
  if (nestingDepth >= 3) {
    signals.push({
      id: `sig-code-cubic-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "high_time_complexity_warning",
      indicator: "concern",
      weight: 2.5,
      offsetMs,
      payload: {
        nestingDepth,
        estimatedBigO: "O(N^3) or higher",
        suggestion: "Consider optimizing deeply nested loops using hash indexes or auxiliary storage.",
      },
      createdAt: now,
    });
  } else if (nestingDepth === 2) {
    signals.push({
      id: `sig-code-quadratic-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "quadratic_time_complexity",
      indicator: "neutral",
      weight: 1.0,
      offsetMs,
      payload: { nestingDepth, estimatedBigO: "O(N^2)" },
      createdAt: now,
    });
  } else if (nestingDepth === 1) {
    signals.push({
      id: `sig-code-linear-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "coding",
      name: "linear_time_complexity",
      indicator: "positive",
      weight: 1.5,
      offsetMs,
      payload: { nestingDepth, estimatedBigO: "O(N)" },
      createdAt: now,
    });
  }

  return signals;
}

/**
 * 2. Extract Execution & Test Suite Signals
 */
function extractExecutionSignals({ executionResult = {}, testCaseResults = [], offsetMs = 0, sessionId = "session-default" } = {}) {
  const signals = [];
  const now = new Date().toISOString();
  const exec = executionResult || {};

  // Sandbox compilation / syntax error
  if (exec.phase === "compile" && exec.exitCode !== 0) {
    signals.push({
      id: `sig-exec-compile-err-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "execution",
      name: "compilation_syntax_error",
      indicator: "concern",
      weight: 1.5,
      offsetMs,
      payload: {
        errorOutput: (exec.stderr || "").slice(0, 500),
        durationMs: exec.durationMs || 0,
      },
      createdAt: now,
    });
  }

  // Sandbox runtime timeout / infinite loop
  if (exec.timedOut) {
    signals.push({
      id: `sig-exec-timeout-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "execution",
      name: "runtime_execution_timeout",
      indicator: "concern",
      weight: 3.0,
      offsetMs,
      payload: {
        durationMs: exec.durationMs || 0,
        explanation: "Process exceeded execution time limit. Possible infinite loop or unoptimized recursion.",
      },
      createdAt: now,
    });
  }

  // Test Case Pass Metrics
  if (Array.isArray(testCaseResults) && testCaseResults.length > 0) {
    const passed = testCaseResults.filter((tc) => tc.passed).length;
    const total = testCaseResults.length;
    const passRatio = passed / total;

    if (passRatio === 1.0) {
      signals.push({
        id: `sig-exec-allpass-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        sessionId,
        category: "execution",
        name: "test_suite_all_passed",
        indicator: "positive",
        weight: 3.5,
        offsetMs,
        payload: { passedCount: passed, totalCount: total, passRatio: 1.0 },
        createdAt: now,
      });
    } else if (passRatio >= 0.5) {
      signals.push({
        id: `sig-exec-partialpass-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        sessionId,
        category: "execution",
        name: "test_suite_partial_pass",
        indicator: "neutral",
        weight: 1.5,
        offsetMs,
        payload: { passedCount: passed, totalCount: total, passRatio },
        createdAt: now,
      });
    } else {
      signals.push({
        id: `sig-exec-failed-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        sessionId,
        category: "execution",
        name: "test_suite_failures",
        indicator: "concern",
        weight: 2.0,
        offsetMs,
        payload: { passedCount: passed, totalCount: total, passRatio },
        createdAt: now,
      });
    }
  }

  return signals;
}

/**
 * 3. Extract Communication & Speech Cadence Signals
 */
function extractSpeechSignals({ transcriptSegments = [], candidateId = "", offsetMs = 0, sessionId = "session-default" }) {
  const signals = [];
  const now = new Date().toISOString();

  if (!Array.isArray(transcriptSegments) || transcriptSegments.length === 0) {
    return signals;
  }

  let candidateWords = 0;
  let interviewerWords = 0;
  const clarifyingRegex = /\b(?:what if|can we assume|edge cases?|constraints?|empty input|null input|negative numbers?|scale|concurrency|latency)\b/i;
  let clarificationCount = 0;

  const techVocabRegex = /\b(?:complexity|asymptotic|idempotent|distributed|cache|latency|throughput|semaphore|mutex|transaction|acid|consistency|partition|tradeoff|amortized)\b/i;
  let techVocabCount = 0;

  for (const seg of transcriptSegments) {
    const text = seg.text || "";
    const words = text.split(/\s+/).filter(Boolean).length;
    const isCandidate = String(seg.participantId || seg.speakerId) === String(candidateId) || seg.participantRole === "seeker";

    if (isCandidate) {
      candidateWords += words;
      const clarifyMatches = text.match(new RegExp(clarifyingRegex.source, "gi")) || [];
      clarificationCount += clarifyMatches.length;

      const techMatches = text.match(new RegExp(techVocabRegex.source, "gi")) || [];
      techVocabCount += techMatches.length;
    } else {
      interviewerWords += words;
    }
  }

  // Clarifying Questions Signal
  if (clarificationCount > 0) {
    signals.push({
      id: `sig-speech-clarify-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "communication",
      name: "clarifying_questions_inquiry",
      indicator: "positive",
      weight: 2.5,
      offsetMs,
      payload: {
        occurrences: clarificationCount,
        description: "Candidate proactively clarified problem constraints, scale, or edge cases before/during solution.",
      },
      createdAt: now,
    });
  }

  // Technical Vocabulary Signal
  if (techVocabCount > 0) {
    signals.push({
      id: `sig-speech-techvocab-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "communication",
      name: "technical_terminology_fluency",
      indicator: "positive",
      weight: 2.0,
      offsetMs,
      payload: {
        occurrences: techVocabCount,
        description: "Candidate articulated solution tradeoffs using precise systems and algorithmic vocabulary.",
      },
      createdAt: now,
    });
  }

  // Talk Ratio Analysis
  const totalWords = candidateWords + interviewerWords;
  if (totalWords > 50) {
    const candidateRatio = candidateWords / totalWords;
    if (candidateRatio >= 0.45 && candidateRatio <= 0.85) {
      signals.push({
        id: `sig-speech-cadence-balanced-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        sessionId,
        category: "communication",
        name: "balanced_dialogue_cadence",
        indicator: "positive",
        weight: 1.5,
        offsetMs,
        payload: { candidateRatio: Math.round(candidateRatio * 100) / 100 },
        createdAt: now,
      });
    }
  }

  return signals;
}

/**
 * 4. Extract Whiteboard Structural Graph Signals
 */
function extractWhiteboardSignals({ whiteboardData = {}, offsetMs = 0, sessionId = "session-default" } = {}) {
  const signals = [];
  const now = new Date().toISOString();
  const wb = whiteboardData || {};
  const elements = Array.isArray(wb.elements) ? wb.elements : [];

  if (elements.length === 0) return signals;

  const boxes = elements.filter((e) => e && (e.type === "rectangle" || e.type === "diamond" || e.type === "ellipse"));
  const arrows = elements.filter((e) => e && (e.type === "arrow" || e.type === "line"));
  const textLabels = elements.filter((e) => e && e.type === "text");

  if (boxes.length >= 3 && arrows.length >= 2) {
    signals.push({
      id: `sig-board-arch-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "whiteboard",
      name: "structured_architecture_diagram",
      indicator: "positive",
      weight: 2.5,
      offsetMs,
      payload: {
        nodeCount: boxes.length,
        edgeCount: arrows.length,
        labelCount: textLabels.length,
        description: "Candidate visualized system architecture components with directional data flow arrows.",
      },
      createdAt: now,
    });
  }

  return signals;
}

/**
 * 5. Extract Browser Attention Signals (Non-punitive Informational Telemetry)
 */
function extractAttentionSignals({ focusEvents = [], offsetMs = 0, sessionId = "session-default" } = {}) {
  const signals = [];
  const now = new Date().toISOString();

  if (!Array.isArray(focusEvents) || focusEvents.length === 0) {
    return signals;
  }

  const blurEvents = focusEvents.filter((e) => e.eventType === "focus.window_blur" || e.eventType === "focus.tab_hidden");

  if (blurEvents.length > 5) {
    signals.push({
      id: `sig-attn-switches-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sessionId,
      category: "attention",
      name: "frequent_window_context_switch",
      indicator: "neutral",
      weight: 1.0,
      offsetMs,
      payload: {
        switchCount: blurEvents.length,
        note: "Informational signal: Candidate switched active browser tabs during session.",
      },
      createdAt: now,
    });
  }

  return signals;
}

/**
 * Comprehensive Multi-Modal Extraction Master Function
 */
function extractAllSignals({
  sessionId,
  code = "",
  language = "javascript",
  activeFile = "/solution.py",
  executionResult = {},
  testCaseResults = [],
  transcriptSegments = [],
  candidateId = "",
  whiteboardData = {},
  focusEvents = [],
  offsetMs = 0,
}) {
  const all = [
    ...extractCodeSignals({ code, language, activeFile, offsetMs, sessionId }),
    ...extractExecutionSignals({ executionResult, testCaseResults, offsetMs, sessionId }),
    ...extractSpeechSignals({ transcriptSegments, candidateId, offsetMs, sessionId }),
    ...extractWhiteboardSignals({ whiteboardData, offsetMs, sessionId }),
    ...extractAttentionSignals({ focusEvents, offsetMs, sessionId }),
  ];

  logger.debug({ sessionId, signalCount: all.length }, "Extracted multi-modal interview signals");
  return all;
}

module.exports = {
  extractCodeSignals,
  extractExecutionSignals,
  extractSpeechSignals,
  extractWhiteboardSignals,
  extractAttentionSignals,
  extractAllSignals,
  cleanExecutableCode,
  calculateLoopNesting,
};
