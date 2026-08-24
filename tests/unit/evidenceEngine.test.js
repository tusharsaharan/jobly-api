const {
  createEvidenceReference,
  verifyEvidenceReference,
  computeVerificationHash,
} = require("../../src/modules/signals/evidenceEngine");
const TimelineEvent = require("../../src/models/TimelineEvent");

describe("Evidence Engine Unit Tests", () => {
  it("should create structured EvidenceReference with valid hash", () => {
    const ref = createEvidenceReference({
      type: "CODE_CHECKPOINT",
      timelineEventId: "507f1f77bcf86cd799439011",
      offsetMs: 45000,
      locator: { file: "/solution.py", startLine: 10, endLine: 25 },
      summary: "Implemented two-pointer loop boundary",
    });

    expect(ref.id).toMatch(/^ev-\d+-[a-f0-9]+$/);
    expect(ref.type).toBe("CODE_CHECKPOINT");
    expect(ref.timelineEventId).toBe("507f1f77bcf86cd799439011");
    expect(ref.offsetMs).toBe(45000);
    expect(ref.locator.file).toBe("/solution.py");
    expect(ref.locator.startLine).toBe(10);
    expect(ref.locator.endLine).toBe(25);
    expect(ref.verificationHash).toBeDefined();
    expect(ref.verificationHash.length).toBe(16);
  });

  it("should generate deterministic hash for identical evidence inputs", () => {
    const hash1 = computeVerificationHash("TRANSCRIPT", 12000, { quote: "constant time" }, "Quote evidence");
    const hash2 = computeVerificationHash("TRANSCRIPT", 12000, { quote: "constant time" }, "Quote evidence");
    const hash3 = computeVerificationHash("TRANSCRIPT", 12000, { quote: "different quote" }, "Quote evidence");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  it("should throw error when missing required creation fields", () => {
    expect(() => createEvidenceReference({ type: "CODE_CHECKPOINT" })).toThrow();
  });

  it("should fail verification when referenced timeline event does not exist", async () => {
    const ref = createEvidenceReference({
      type: "TIMELINE_EVENT",
      timelineEventId: "507f1f77bcf86cd799439999",
      offsetMs: 10000,
      locator: {},
      summary: "Non-existent event",
    });

    const result = await verifyEvidenceReference(ref);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not found in database");
  });
});
