const {
  scoreInterviewSession,
  scoreProblemSolving,
  scoreCodingAlgorithms,
  scoreSystemDesign,
  scoreCommunication,
} = require("../../src/modules/signals/rubricScorer");

describe("Rubric Scorer Unit Tests", () => {
  const mockEvidence = [
    {
      id: "ev-1",
      type: "TRANSCRIPT",
      timelineEventId: "507f1f77bcf86cd799439011",
      offsetMs: 5000,
      locator: { quote: "What if empty array?" },
      summary: "Clarified edge cases",
      verificationHash: "abc123def456",
    },
    {
      id: "ev-2",
      type: "CODE_CHECKPOINT",
      timelineEventId: "507f1f77bcf86cd799439012",
      offsetMs: 25000,
      locator: { file: "/solution.py", startLine: 1, endLine: 15 },
      summary: "Hash map implementation",
      verificationHash: "123abc456def",
    },
  ];

  it("should score Problem Solving pillar accurately with positive signals", () => {
    const signals = [
      { name: "clarifying_questions_inquiry" },
      { name: "test_suite_all_passed" },
    ];
    const result = scoreProblemSolving(signals, mockEvidence);
    expect(result.pillar).toBe("problem_solving");
    expect(result.score).toBeGreaterThanOrEqual(4);
    expect(result.rubricLevel).toMatch(/strong|exceptional/);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("should score Algorithmic Implementation pillar accurately with data structures", () => {
    const signals = [
      { name: "data_structure_hash_map" },
      { name: "algorithmic_dynamic_programming" },
      { name: "test_suite_all_passed" },
    ];
    const result = scoreCodingAlgorithms(signals, mockEvidence);
    expect(result.pillar).toBe("coding_algorithms");
    expect(result.score).toBeGreaterThanOrEqual(4);
  });

  it("should penalize Algorithmic Implementation on cubic time complexity", () => {
    const signals = [
      { name: "high_time_complexity_warning" },
      { name: "compilation_syntax_error" },
    ];
    const result = scoreCodingAlgorithms(signals, []);
    expect(result.score).toBeLessThanOrEqual(2);
    expect(result.rubricLevel).toMatch(/unsatisfactory|needs_growth/);
  });

  it("should compute comprehensive session evaluation with STRONG_HIRE recommendation", () => {
    const signals = [
      { name: "clarifying_questions_inquiry" },
      { name: "data_structure_hash_map" },
      { name: "algorithmic_binary_search" },
      { name: "test_suite_all_passed" },
      { name: "structured_architecture_diagram" },
      { name: "balanced_dialogue_cadence" },
      { name: "technical_terminology_fluency" },
    ];

    const evaluation = scoreInterviewSession({
      signals,
      evidenceReferences: mockEvidence,
      sessionId: "507f1f77bcf86cd799439001",
      candidateId: "507f1f77bcf86cd799439002",
      interviewerId: "507f1f77bcf86cd799439003",
    });

    expect(evaluation.schemaVersion).toBe("signals-engine/2026-08-v1");
    expect(evaluation.overallScore).toBeGreaterThanOrEqual(80);
    expect(evaluation.recommendedDecision).toMatch(/STRONG_HIRE|HIRE/);
    expect(evaluation.competencies.length).toBe(4);
    expect(evaluation.strengths.length).toBeGreaterThan(0);
    expect(evaluation.exclusions.some((e) => e.field === "protected_characteristics")).toBe(true);
  });

  it("should compute REJECT recommendation on across-the-board failures", () => {
    const signals = [
      { name: "high_time_complexity_warning" },
      { name: "compilation_syntax_error" },
      { name: "runtime_execution_timeout" },
      { name: "test_suite_failures" },
    ];

    const evaluation = scoreInterviewSession({
      signals,
      evidenceReferences: [],
      sessionId: "507f1f77bcf86cd799439001",
      candidateId: "507f1f77bcf86cd799439002",
    });

    expect(evaluation.overallScore).toBeLessThanOrEqual(50);
    expect(evaluation.recommendedDecision).toMatch(/REJECT|LEAN_REJECT/);
    expect(evaluation.growthAreas.length).toBeGreaterThan(0);
  });
});
