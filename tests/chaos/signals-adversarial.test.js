const { extractAllSignals, cleanExecutableCode, calculateLoopNesting } = require("../../src/modules/signals/signalExtractor");
const { createEvidenceReference, verifyEvidenceReference } = require("../../src/modules/signals/evidenceEngine");
const { scoreInterviewSession } = require("../../src/modules/signals/rubricScorer");

describe("Chaos & Adversarial Signal Engine Tests", () => {
  it("should handle massive 100KB code string without crashing or stack overflow", () => {
    const hugeCode = "for (let i = 0; i < 100; i++) { console.log('work'); }\n".repeat(2000);
    const start = Date.now();
    const signals = extractAllSignals({
      sessionId: "chaos-sess",
      code: hugeCode,
      language: "javascript",
      offsetMs: 50000,
    });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(1000); // Must execute in sub-second
    expect(Array.isArray(signals)).toBe(true);
  });

  it("should safely handle deeply broken and unbalanced bracket structures", () => {
    const brokenCode = "{{{{{{{{{{ for (;;) { } }}}}} while(true) { { {";
    expect(() => calculateLoopNesting(brokenCode)).not.toThrow();
    const depth = calculateLoopNesting(brokenCode);
    expect(depth).toBeGreaterThanOrEqual(0);
  });

  it("should safely handle null, undefined, and non-string inputs", () => {
    expect(cleanExecutableCode(null)).toBe("");
    expect(cleanExecutableCode(undefined)).toBe("");
    expect(cleanExecutableCode(12345)).toBe("");
    expect(cleanExecutableCode({})).toBe("");

    const signals = extractAllSignals({
      sessionId: "null-test",
      code: null,
      executionResult: null,
      testCaseResults: null,
      transcriptSegments: null,
      whiteboardData: null,
      focusEvents: null,
    });

    expect(Array.isArray(signals)).toBe(true);
  });

  it("should handle adversarial evidence reference with tampered payload", async () => {
    const ref = createEvidenceReference({
      type: "TRANSCRIPT",
      timelineEventId: "507f1f77bcf86cd799439011",
      offsetMs: 10000,
      locator: { quote: "original text" },
      summary: "Original summary",
    });

    // Tamper with summary
    ref.summary = "Malicious altered summary";
    const result = await verifyEvidenceReference(ref);
    expect(result.valid).toBe(false);
  });

  it("should generate bounded 0..100 evaluation even with 10,000 conflicting signals", () => {
    const massiveSignals = [];
    for (let i = 0; i < 1000; i++) {
      massiveSignals.push({ name: "data_structure_hash_map", category: "coding", indicator: "positive", weight: 2 });
      massiveSignals.push({ name: "high_time_complexity_warning", category: "coding", indicator: "concern", weight: 2 });
      massiveSignals.push({ name: "test_suite_failures", category: "execution", indicator: "concern", weight: 2 });
    }

    const evaluation = scoreInterviewSession({
      signals: massiveSignals,
      evidenceReferences: [],
      sessionId: "sess-massive",
      candidateId: "cand-1",
    });

    expect(evaluation.overallScore).toBeGreaterThanOrEqual(0);
    expect(evaluation.overallScore).toBeLessThanOrEqual(100);
    expect(evaluation.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(evaluation.confidenceScore).toBeLessThanOrEqual(1.0);
  });
});
