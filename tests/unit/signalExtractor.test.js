const {
  extractCodeSignals,
  extractExecutionSignals,
  extractSpeechSignals,
  extractWhiteboardSignals,
  extractAttentionSignals,
  extractAllSignals,
  cleanExecutableCode,
  calculateLoopNesting,
} = require("../../src/modules/signals/signalExtractor");

describe("Signal Extractor Unit Tests", () => {
  describe("cleanExecutableCode & calculateLoopNesting", () => {
    it("should strip single-line and multi-line comments", () => {
      const raw = `
        // This is a comment
        /* Multi-line
           comment */
        # Python comment
        const x = 10;
      `;
      const clean = cleanExecutableCode(raw);
      expect(clean).not.toContain("This is a comment");
      expect(clean).not.toContain("Multi-line");
      expect(clean).toContain("const x = 10;");
    });

    it("should calculate nested loop depth correctly", () => {
      const code = `
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            console.log(i, j);
          }
        }
      `;
      const depth = calculateLoopNesting(code);
      expect(depth).toBe(2);
    });

    it("should detect cubic loop nesting", () => {
      const code = `
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            for (let k = 0; k < n; k++) {
              doWork();
            }
          }
        }
      `;
      const depth = calculateLoopNesting(code);
      expect(depth).toBe(3);
    });
  });

  describe("extractCodeSignals", () => {
    it("should detect hash map and set usage", () => {
      const code = `
        function twoSum(nums, target) {
          const map = new Map();
          const seen = new Set();
          for (let i = 0; i < nums.length; i++) {
            map.set(nums[i], i);
          }
          return [];
        }
      `;
      const signals = extractCodeSignals({ code, language: "javascript", offsetMs: 5000 });
      const signalNames = signals.map((s) => s.name);
      expect(signalNames).toContain("data_structure_hash_map");
      expect(signalNames).toContain("data_structure_set");
      expect(signalNames).toContain("linear_time_complexity");
    });

    it("should detect dynamic programming memoization", () => {
      const code = `
        def fib(n, memo = {}):
            if n in memo: return memo[n]
            dp = [0] * (n + 1)
            return dp[n]
      `;
      const signals = extractCodeSignals({ code, language: "python", offsetMs: 12000 });
      const signalNames = signals.map((s) => s.name);
      expect(signalNames).toContain("algorithmic_dynamic_programming");
    });

    it("should detect binary search boundaries", () => {
      const code = `
        function binarySearch(arr, target) {
          let low = 0, high = arr.length - 1;
          while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            if (arr[mid] === target) return mid;
          }
          return -1;
        }
      `;
      const signals = extractCodeSignals({ code, language: "javascript", offsetMs: 20000 });
      const signalNames = signals.map((s) => s.name);
      expect(signalNames).toContain("algorithmic_binary_search");
    });

    it("should flag cubic time complexity warning", () => {
      const code = `
        for i in range(n):
            for j in range(n):
                for k in range(n):
                    print(i, j, k)
      `;
      const signals = extractCodeSignals({ code, language: "python", offsetMs: 30000 });
      const cubicSig = signals.find((s) => s.name === "high_time_complexity_warning");
      expect(cubicSig).toBeDefined();
      expect(cubicSig.indicator).toBe("concern");
    });
  });

  describe("extractExecutionSignals", () => {
    it("should emit compilation error signal on failed build", () => {
      const signals = extractExecutionSignals({
        executionResult: { phase: "compile", exitCode: 1, stderr: "SyntaxError: Unexpected token" },
        offsetMs: 15000,
      });
      expect(signals.some((s) => s.name === "compilation_syntax_error")).toBe(true);
    });

    it("should emit timeout signal on infinite loop", () => {
      const signals = extractExecutionSignals({
        executionResult: { timedOut: true, durationMs: 8000 },
        offsetMs: 25000,
      });
      const timeoutSig = signals.find((s) => s.name === "runtime_execution_timeout");
      expect(timeoutSig).toBeDefined();
      expect(timeoutSig.indicator).toBe("concern");
    });

    it("should emit all-pass signal when all test cases succeed", () => {
      const testCases = [
        { passed: true, input: "1", expectedOutput: "1", actualOutput: "1" },
        { passed: true, input: "2", expectedOutput: "2", actualOutput: "2" },
      ];
      const signals = extractExecutionSignals({
        executionResult: { exitCode: 0, phase: "run" },
        testCaseResults: testCases,
        offsetMs: 40000,
      });
      const allPass = signals.find((s) => s.name === "test_suite_all_passed");
      expect(allPass).toBeDefined();
      expect(allPass.indicator).toBe("positive");
    });
  });

  describe("extractSpeechSignals", () => {
    it("should detect clarifying questions from candidate transcript", () => {
      const transcript = [
        { text: "What if the input array contains negative numbers or is empty?", participantRole: "seeker" },
        { text: "Good question, assume positive integers only.", participantRole: "recruiter" },
      ];
      const signals = extractSpeechSignals({ transcriptSegments: transcript, offsetMs: 8000 });
      expect(signals.some((s) => s.name === "clarifying_questions_inquiry")).toBe(true);
    });

    it("should detect technical vocabulary fluency", () => {
      const transcript = [
        { text: "We can maintain an idempotent cache to reduce read latency and avoid distributed locks.", participantRole: "seeker" },
      ];
      const signals = extractSpeechSignals({ transcriptSegments: transcript, offsetMs: 14000 });
      expect(signals.some((s) => s.name === "technical_terminology_fluency")).toBe(true);
    });
  });

  describe("extractWhiteboardSignals", () => {
    it("should detect structured architecture diagram with connected nodes", () => {
      const whiteboardData = {
        elements: [
          { type: "rectangle", id: "1" },
          { type: "rectangle", id: "2" },
          { type: "ellipse", id: "3" },
          { type: "arrow", id: "4" },
          { type: "arrow", id: "5" },
          { type: "text", id: "6", text: "API Gateway" },
        ],
      };
      const signals = extractWhiteboardSignals({ whiteboardData, offsetMs: 50000 });
      expect(signals.some((s) => s.name === "structured_architecture_diagram")).toBe(true);
    });
  });

  describe("extractAllSignals aggregator", () => {
    it("should aggregate multi-modal signals into unified list", () => {
      const all = extractAllSignals({
        sessionId: "sess-123",
        code: "const map = new Map();",
        language: "javascript",
        executionResult: { exitCode: 0 },
        testCaseResults: [{ passed: true }],
        transcriptSegments: [{ text: "Can we assume unique keys?", participantRole: "seeker" }],
        offsetMs: 60000,
      });

      expect(all.length).toBeGreaterThanOrEqual(3);
      expect(all.every((s) => s.sessionId === "sess-123")).toBe(true);
      expect(all.every((s) => s.id && s.category && s.createdAt)).toBe(true);
    });
  });
});
