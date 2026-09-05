const { executeCodeSandbox, runTestCases } = require("../../src/infrastructure/sandbox/sandboxService");

describe("Phase 4: Secure Sandbox Code Execution Engine", () => {
  describe("Multi-Language Sandbox Execution", () => {
    it("should execute JavaScript code and capture stdout correctly", async () => {
      const code = `
        const nums = [1, 2, 3, 4, 5];
        const sum = nums.reduce((a, b) => a + b, 0);
        console.log(sum);
      `;

      const result = await executeCodeSandbox({ language: "javascript", code });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("15");
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should execute Python code and capture stdout correctly", async () => {
      const code = `
def factorial(n):
    return 1 if n <= 1 else n * factorial(n - 1)

print(factorial(5))
      `;

      const result = await executeCodeSandbox({ language: "python", code });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("120");
      expect(result.timedOut).toBe(false);
    });

    it("should handle standard input (stdin) properly", async () => {
      const code = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (line) => {
    console.log('Echo: ' + line.toUpperCase());
    process.exit(0);
});
      `;

      const result = await executeCodeSandbox({ language: "javascript", code, stdin: "hello jobly" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("Echo: HELLO JOBLY");
    });
  });

  describe("Security & Infinite Loop Termination", () => {
    it("should terminate infinite loop processes and flag timeout (SIGKILL watchdog)", async () => {
      const code = `
        while (true) {
          // infinite loop
        }
      `;

      const result = await executeCodeSandbox({ language: "javascript", code, timeoutMs: 1500 });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(124);
      expect(result.stderr).toContain("Execution Timed Out");
    });

    it("should gracefully capture runtime syntax errors without crashing", async () => {
      const code = `
        const a = ; // syntax error
      `;

      const result = await executeCodeSandbox({ language: "javascript", code });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("SyntaxError");
    });
  });

  describe("Automated Test Case Runner", () => {
    it("should evaluate candidate code against visible and hidden test cases", async () => {
      const code = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
    const n = parseInt(line, 10);
    console.log(n * 2);
});
      `;

      const testCases = [
        { input: "5", expectedOutput: "10", isHidden: false },
        { input: "12", expectedOutput: "24", isHidden: true },
        { input: "0", expectedOutput: "0", isHidden: false },
      ];

      const testRun = await runTestCases({ language: "javascript", code, testCases });
      expect(testRun.allPassed).toBe(true);
      expect(testRun.passedCount).toBe(3);
      expect(testRun.totalCount).toBe(3);
      expect(testRun.results[1].input).toBe("[Hidden Test Case]");
    });
  });
});
