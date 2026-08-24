const { SIGNAL_ENGINE_VERSION } = require("@jobly/contracts");
const logger = require("../../config/logger");

const RUBRIC_LEVEL_MAP = {
  1: "unsatisfactory",
  2: "needs_growth",
  3: "competent",
  4: "strong",
  5: "exceptional",
};

/**
 * Score Problem Solving & Decomposition Pillar
 */
function scoreProblemSolving(signals, evidenceRefs) {
  let score = 3.0; // Baseline: Competent
  const observed = [];
  const matchedEvidence = [];

  const hasClarifications = signals.some((s) => s.name === "clarifying_questions_inquiry");
  const hasAllPass = signals.some((s) => s.name === "test_suite_all_passed");
  const hasPartialPass = signals.some((s) => s.name === "test_suite_partial_pass");
  const hasTimeouts = signals.some((s) => s.name === "runtime_execution_timeout");

  if (hasClarifications) {
    score += 1.0;
    observed.push("Proactively clarified constraints and edge cases before coding");
  }
  if (hasAllPass) {
    score += 1.0;
    observed.push("Systematically verified solution against automated test suite");
  } else if (hasPartialPass) {
    score += 0.3;
    observed.push("Iterated on initial solution with partial test pass rate");
  }

  if (hasTimeouts) {
    score -= 1.0;
    observed.push("Encountered unhandled boundary condition resulting in execution timeout");
  }

  score = Math.max(1, Math.min(5, Math.round(score)));

  // Attach relevant evidence
  for (const ref of evidenceRefs) {
    if (ref.type === "TRANSCRIPT" || ref.type === "EXECUTION_RESULT") {
      matchedEvidence.push(ref);
    }
  }

  return {
    pillar: "problem_solving",
    label: "Problem Solving & Decomposition",
    score,
    confidence: Math.min(0.95, 0.75 + observed.length * 0.08),
    rationale: observed.join(". ") || "Candidate demonstrated standard algorithmic problem decomposition.",
    rubricLevel: RUBRIC_LEVEL_MAP[score] || "competent",
    evidenceReferences: matchedEvidence.slice(0, 5),
    signalsObserved: observed,
  };
}

/**
 * Score Algorithmic Implementation & Code Quality Pillar
 */
function scoreCodingAlgorithms(signals, evidenceRefs) {
  let score = 3.0;
  const observed = [];
  const matchedEvidence = [];

  const hasHashMap = signals.some((s) => s.name === "data_structure_hash_map");
  const hasSet = signals.some((s) => s.name === "data_structure_set");
  const hasHeapQueue = signals.some((s) => s.name === "data_structure_heap_queue");
  const hasDP = signals.some((s) => s.name === "algorithmic_dynamic_programming");
  const hasBinSearch = signals.some((s) => s.name === "algorithmic_binary_search");
  const hasTwoPointers = signals.some((s) => s.name === "algorithmic_two_pointers");
  const hasCubicComplexity = signals.some((s) => s.name === "high_time_complexity_warning");
  const hasSyntaxErrors = signals.some((s) => s.name === "compilation_syntax_error");
  const hasAllPass = signals.some((s) => s.name === "test_suite_all_passed");

  if (hasHashMap || hasSet) {
    score += 0.5;
    observed.push("Utilized constant-time lookup data structures");
  }
  if (hasHeapQueue || hasDP || hasBinSearch || hasTwoPointers) {
    score += 1.0;
    observed.push("Applied optimal algorithmic paradigms (Heap/DP/Binary Search)");
  }
  if (hasAllPass) {
    score += 0.5;
    observed.push("Clean algorithmic execution with zero runtime exceptions");
  }

  if (hasCubicComplexity) {
    score -= 1.0;
    observed.push("Sub-optimal cubic time complexity in nested loop structures");
  }
  if (hasSyntaxErrors) {
    score -= 0.5;
    observed.push("Multiple syntax compilation disruptions during implementation");
  }

  score = Math.max(1, Math.min(5, Math.round(score)));

  for (const ref of evidenceRefs) {
    if (ref.type === "CODE_CHECKPOINT" || ref.type === "EXECUTION_RESULT") {
      matchedEvidence.push(ref);
    }
  }

  return {
    pillar: "coding_algorithms",
    label: "Algorithmic Implementation & Code Quality",
    score,
    confidence: Math.min(0.98, 0.8 + observed.length * 0.06),
    rationale: observed.join(". ") || "Candidate wrote functional implementation with standard complexity.",
    rubricLevel: RUBRIC_LEVEL_MAP[score] || "competent",
    evidenceReferences: matchedEvidence.slice(0, 5),
    signalsObserved: observed,
  };
}

/**
 * Score System Architecture & Tradeoff Reasoning Pillar
 */
function scoreSystemDesign(signals, evidenceRefs) {
  let score = 3.0;
  const observed = [];
  const matchedEvidence = [];

  const hasArchDiagram = signals.some((s) => s.name === "structured_architecture_diagram");
  const hasTechVocab = signals.some((s) => s.name === "technical_terminology_fluency");

  if (hasArchDiagram) {
    score += 1.5;
    observed.push("Created structured system architecture diagram with clear component data flow");
  }
  if (hasTechVocab) {
    score += 0.5;
    observed.push("Articulated concrete trade-offs around latency, caching, and scalability");
  }

  score = Math.max(1, Math.min(5, Math.round(score)));

  for (const ref of evidenceRefs) {
    if (ref.type === "WHITEBOARD_SNAPSHOT" || ref.type === "TRANSCRIPT") {
      matchedEvidence.push(ref);
    }
  }

  return {
    pillar: "system_design",
    label: "System Architecture & Tradeoff Reasoning",
    score,
    confidence: Math.min(0.95, 0.75 + observed.length * 0.1),
    rationale: observed.join(". ") || "Standard consideration of architectural trade-offs.",
    rubricLevel: RUBRIC_LEVEL_MAP[score] || "competent",
    evidenceReferences: matchedEvidence.slice(0, 5),
    signalsObserved: observed,
  };
}

/**
 * Score Technical Communication & Collaboration Pillar
 */
function scoreCommunication(signals, evidenceRefs) {
  let score = 3.0;
  const observed = [];
  const matchedEvidence = [];

  const hasCadence = signals.some((s) => s.name === "balanced_dialogue_cadence");
  const hasTechVocab = signals.some((s) => s.name === "technical_terminology_fluency");
  const hasClarifications = signals.some((s) => s.name === "clarifying_questions_inquiry");

  if (hasCadence) {
    score += 0.8;
    observed.push("Maintained balanced, engaging conversational cadence with interviewer");
  }
  if (hasTechVocab) {
    score += 0.6;
    observed.push("Accurately expressed technical engineering concepts");
  }
  if (hasClarifications) {
    score += 0.6;
    observed.push("Constructive collaborative inquiry throughout problem lifecycle");
  }

  score = Math.max(1, Math.min(5, Math.round(score)));

  for (const ref of evidenceRefs) {
    if (ref.type === "TRANSCRIPT") {
      matchedEvidence.push(ref);
    }
  }

  return {
    pillar: "communication",
    label: "Technical Communication & Collaboration",
    score,
    confidence: Math.min(0.95, 0.8 + observed.length * 0.06),
    rationale: observed.join(". ") || "Clear and professional technical communication.",
    rubricLevel: RUBRIC_LEVEL_MAP[score] || "competent",
    evidenceReferences: matchedEvidence.slice(0, 5),
    signalsObserved: observed,
  };
}

/**
 * Master Rubric Evaluation Generator
 */
function scoreInterviewSession({
  signals = [],
  evidenceReferences = [],
  sessionId = "session-default",
  candidateId = "candidate-default",
  interviewerId = "recruiter-default",
}) {
  const comp1 = scoreProblemSolving(signals, evidenceReferences);
  const comp2 = scoreCodingAlgorithms(signals, evidenceReferences);
  const comp3 = scoreSystemDesign(signals, evidenceReferences);
  const comp4 = scoreCommunication(signals, evidenceReferences);

  const competencies = [comp1, comp2, comp3, comp4];
  const averagePillarScore = competencies.reduce((sum, c) => sum + c.score, 0) / competencies.length;
  const overallScore = Math.round((averagePillarScore / 5) * 100);

  const minPillarScore = Math.min(...competencies.map((c) => c.score));

  let recommendedDecision = "LEAN_HIRE";
  if (overallScore >= 85 && minPillarScore >= 3) {
    recommendedDecision = "STRONG_HIRE";
  } else if (overallScore >= 70 && minPillarScore >= 3) {
    recommendedDecision = "HIRE";
  } else if (overallScore >= 55) {
    recommendedDecision = "LEAN_HIRE";
  } else if (overallScore >= 40) {
    recommendedDecision = "LEAN_REJECT";
  } else {
    recommendedDecision = "REJECT";
  }

  // Aggregate strengths & growth areas
  const strengths = [];
  const growthAreas = [];

  for (const comp of competencies) {
    if (comp.score >= 4) {
      strengths.push(`${comp.label}: ${comp.rationale}`);
    } else if (comp.score <= 2) {
      growthAreas.push(`${comp.label}: ${comp.rationale}`);
    }
  }

  if (strengths.length === 0) {
    strengths.push("Demonstrated competent core algorithmic and problem-solving capability.");
  }
  if (growthAreas.length === 0) {
    growthAreas.push("Continue expanding deep systems scalability under extreme concurrency.");
  }

  const confidenceScore = Math.round((competencies.reduce((sum, c) => sum + c.confidence, 0) / competencies.length) * 100) / 100;

  return {
    schemaVersion: SIGNAL_ENGINE_VERSION,
    id: `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: String(sessionId),
    candidateId: String(candidateId),
    interviewerId: String(interviewerId),
    recommendedDecision,
    overallScore,
    confidenceScore,
    competencies,
    strengths,
    growthAreas,
    evidenceReferences,
    exclusions: [
      { field: "protected_characteristics", reason: "Jobly strictly excludes race, gender, accent, age, religion, and protected data from evaluation." },
      { field: "background_environment", reason: "Jobly does not evaluate candidates based on background audio or camera environment." },
    ],
    calculatedAt: new Date().toISOString(),
    engineVersion: SIGNAL_ENGINE_VERSION,
  };
}

module.exports = {
  scoreInterviewSession,
  scoreProblemSolving,
  scoreCodingAlgorithms,
  scoreSystemDesign,
  scoreCommunication,
  RUBRIC_LEVEL_MAP,
};
