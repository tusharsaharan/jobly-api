const { executeCodeSandbox } = require("../infrastructure/sandbox/sandboxService");

async function runGap2Tests() {
  console.log("=== GAP 2: Execution Sandbox Timeout & Runtime Exception Verification ===\n");

  // 1. Python Infinite Loop Timeout Test
  console.log("1. Running Python Infinite Loop (while True: pass)...");
  const pyStart = Date.now();
  const pyTimeoutRes = await executeCodeSandbox({
    language: "python",
    code: "import time\nprint('Python loop started...')\nwhile True:\n    pass",
  });
  const pyWallTime = Date.now() - pyStart;
  console.log("Python Timeout Result:", {
    wallClockMs: pyWallTime,
    durationMs: pyTimeoutRes.durationMs,
    exitCode: pyTimeoutRes.exitCode,
    timedOut: pyTimeoutRes.timedOut,
    failureKind: pyTimeoutRes.failureKind,
    stdout: pyTimeoutRes.stdout,
    stderr: pyTimeoutRes.stderr,
  });

  // 2. JavaScript Infinite Loop Timeout Test
  console.log("\n2. Running JavaScript Infinite Loop (while (true) {})...");
  const jsStart = Date.now();
  const jsTimeoutRes = await executeCodeSandbox({
    language: "javascript",
    code: "console.log('JS loop started...');\nwhile (true) {}",
  });
  const jsWallTime = Date.now() - jsStart;
  console.log("JavaScript Timeout Result:", {
    wallClockMs: jsWallTime,
    durationMs: jsTimeoutRes.durationMs,
    exitCode: jsTimeoutRes.exitCode,
    timedOut: jsTimeoutRes.timedOut,
    failureKind: jsTimeoutRes.failureKind,
    stdout: jsTimeoutRes.stdout,
    stderr: jsTimeoutRes.stderr,
  });

  // 3. Python Runtime Exception Test (Division by Zero)
  console.log("\n3. Running Python Runtime Exception (Division by Zero)...");
  const pyExceptionStart = Date.now();
  const pyExceptionRes = await executeCodeSandbox({
    language: "python",
    code: "print('Starting division...')\nx = 10 / 0\nprint('Done')",
  });
  const pyExceptionWallTime = Date.now() - pyExceptionStart;
  console.log("Python Exception Result:", {
    wallClockMs: pyExceptionWallTime,
    durationMs: pyExceptionRes.durationMs,
    exitCode: pyExceptionRes.exitCode,
    timedOut: pyExceptionRes.timedOut,
    failureKind: pyExceptionRes.failureKind,
    stdout: pyExceptionRes.stdout,
    stderr: pyExceptionRes.stderr.trim(),
  });

  // 4. JavaScript Runtime Exception Test (Thrown Error)
  console.log("\n4. Running JavaScript Runtime Exception (throw new Error)...");
  const jsExceptionStart = Date.now();
  const jsExceptionRes = await executeCodeSandbox({
    language: "javascript",
    code: "console.log('Starting JS execution...');\nthrow new Error('Deliberate unhandled runtime exception in test');",
  });
  const jsExceptionWallTime = Date.now() - jsExceptionStart;
  console.log("JavaScript Exception Result:", {
    wallClockMs: jsExceptionWallTime,
    durationMs: jsExceptionRes.durationMs,
    exitCode: jsExceptionRes.exitCode,
    timedOut: jsExceptionRes.timedOut,
    failureKind: jsExceptionRes.failureKind,
    stdout: jsExceptionRes.stdout,
    stderr: jsExceptionRes.stderr.trim(),
  });

  console.log("\n=== GAP 2 Tests Completed ===");
}

runGap2Tests().catch((err) => {
  console.error("Gap 2 Test Error:", err);
  process.exit(1);
});
