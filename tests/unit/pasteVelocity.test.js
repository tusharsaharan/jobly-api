const {
  evaluatePasteEvent,
  evaluateFocusEvent,
} = require("../../src/modules/integrity/integrityTelemetryService");

describe("Paste Velocity & Focus Telemetry Unit Tests", () => {
  describe("evaluatePasteEvent", () => {
    it("should classify standard small paste as normal", () => {
      const res = evaluatePasteEvent({
        text: "const a = 5;",
        characterCount: 12,
        durationMs: 50,
        lineCount: 1,
      });

      expect(res.isAnomalous).toBe(false);
      expect(res.classification).toBe("normal_paste");
    });

    it("should flag instant bulk paste exceeding 150 characters in <200ms", () => {
      const codeBlock = "function solveProblem(arr) {\n  return arr.map(x => x * 2).filter(x => x > 10).reduce((a, b) => a + b, 0);\n}\n".repeat(4);
      const res = evaluatePasteEvent({
        text: codeBlock,
        characterCount: codeBlock.length,
        durationMs: 65,
        lineCount: 12,
      });

      expect(res.isAnomalous).toBe(true);
      expect(res.classification).toBe("instant_bulk_paste");
      expect(res.severity).toMatch(/medium|high/);
      expect(res.explanation).toContain("Instant paste of");
    });

    it("should flag simulated robotic keystroke burst (>45 chars/sec)", () => {
      const res = evaluatePasteEvent({
        text: "x".repeat(300),
        characterCount: 300,
        durationMs: 4000, // 75 chars/sec
        lineCount: 1,
      });

      expect(res.isAnomalous).toBe(true);
      expect(res.classification).toBe("simulated_keystroke_burst");
      expect(res.charsPerSec).toBe(75);
    });
  });

  describe("evaluateFocusEvent", () => {
    it("should allow brief tab blurs under 15s", () => {
      const res = evaluateFocusEvent({ type: "blur", durationMs: 4000 });
      expect(res.isAnomalous).toBe(false);
      expect(res.severity).toBe("low");
    });

    it("should flag extended tab switch away (>15s)", () => {
      const res = evaluateFocusEvent({ type: "blur", durationMs: 25000 });
      expect(res.isAnomalous).toBe(true);
      expect(res.severity).toBe("medium");
      expect(res.explanation).toContain("switched away from interview workspace");
    });

    it("should flag fullscreen exit event", () => {
      const res = evaluateFocusEvent({ type: "fullscreen_exit", durationMs: 0 });
      expect(res.isAnomalous).toBe(true);
      expect(res.severity).toBe("medium");
    });
  });
});
