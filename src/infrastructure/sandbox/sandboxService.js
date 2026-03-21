const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const logger = require("../../config/logger");

// Language runtime execution parameters
const RUNTIMES = {
  python: {
    extension: "py",
    command: "python",
    getArgs: (filepath) => [filepath],
    timeoutMs: 8000,
    memoryLimitMb: 256,
  },
  javascript: {
    extension: "js",
    command: "node",
    getArgs: (filepath) => [filepath],
    timeoutMs: 8000,
    memoryLimitMb: 256,
  },
  typescript: {
    extension: "ts",
    command: "tsx",
    getArgs: (filepath) => [filepath],
    timeoutMs: 10000,
    memoryLimitMb: 256,
  },
  cpp: {
    extension: "cpp",
    isCompiled: true,
    compileCmd: "g++",
    getCompileArgs: (src, bin) => [src, "-O2", "-pipe", "-std=gnu++20", "-o", bin],
    command: (bin) => bin,
    timeoutMs: 8000,
    memoryLimitMb: 256,
  },
  java: {
    extension: "java",
    isCompiled: true,
    compileCmd: "javac",
    sourceFileName: (code) => {
      const match = String(code).match(/public\s+(?:final\s+)?class\s+([A-Za-z_$][\w$]*)/);
      return `${match?.[1] || "Solution"}.java`;
    },
    getCompileArgs: (src) => ["-encoding", "UTF-8", src],
    getRunCommand: (src) => "java",
    getRunArgs: (src) => [path.basename(src, ".java")],
    timeoutMs: 10000,
    memoryLimitMb: 512,
  },
};

function runProcess({ command, args, cwd, stdin, timeoutMs }) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: {
          NODE_ENV: "production",
          PATH: process.env.PATH,
          PYTHONUNBUFFERED: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      return finish({ stdout, stderr: error.message, exitCode: 1, durationMs: 0, timedOut: false, error: error.message });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* process has already exited */ }
    }, timeoutMs);

    if (stdin && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else if (child.stdin) {
      child.stdin.end();
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 500000) {
        stderr += "\n[Error] Output buffer limit exceeded (500KB)";
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 500000) child.kill("SIGKILL");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      const [seconds, nanoseconds] = process.hrtime(startedAt);
      finish({
        stdout,
        stderr: stderr || error.message,
        exitCode: 1,
        durationMs: Math.round(seconds * 1000 + nanoseconds / 1e6),
        timedOut: false,
        error: error.message,
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const [seconds, nanoseconds] = process.hrtime(startedAt);
      const durationMs = Math.round(seconds * 1000 + nanoseconds / 1e6);
      if (timedOut || signal === "SIGKILL") {
        return finish({
          stdout,
          stderr: `${stderr}\n[Execution Timed Out] Maximum time limit exceeded.`,
          exitCode: 124,
          durationMs: timeoutMs,
          timedOut: true,
        });
      }
      return finish({ stdout, stderr, exitCode: exitCode ?? (signal ? 1 : 0), durationMs, timedOut: false });
    });
  });
}

function classifyFailure(result, phase) {
  if (result.timedOut) return "timeout";
  if (/ENOENT|not recognized as an internal|command not found/i.test(result.error || result.stderr || "")) {
    return "runtime_unavailable";
  }
  return phase === "compile" ? "compilation_error" : "runtime_error";
}

/**
 * Execute candidate code in an isolated child process sandbox
 * @param {Object} options
 * @param {string} options.language - 'python' | 'javascript' | 'typescript' | 'cpp' | 'java'
 * @param {string} options.code - Source code string
 * @param {string} [options.stdin] - Standard input provided to process
 * @param {number} [options.timeoutMs] - Maximum execution duration before SIGKILL
 * @returns {Promise<Object>} Execution result (stdout, stderr, exitCode, durationMs, timedOut)
 */
async function executeCodeSandbox({ language, code, stdin = "", timeoutMs }) {
  const runtime = RUNTIMES[language.toLowerCase()];
  if (!runtime) {
    throw new Error(`Unsupported runtime language: ${language}`);
  }

  const effectiveTimeout = timeoutMs || runtime.timeoutMs;
  const executionId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), "jobly_sandbox", executionId);

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    const filename = runtime.sourceFileName ? runtime.sourceFileName(code) : `Solution.${runtime.extension}`;
    const sourceFilePath = path.join(tempDir, filename);
    fs.writeFileSync(sourceFilePath, code, "utf8");

    if (runtime.isCompiled) {
      const binaryPath = path.join(tempDir, "solution-bin");
      const compileResult = await runProcess({
        command: runtime.compileCmd,
        args: runtime.getCompileArgs(sourceFilePath, binaryPath),
        cwd: tempDir,
        timeoutMs: Math.min(effectiveTimeout, 12000),
      });
      if (compileResult.exitCode !== 0 || compileResult.timedOut) {
        return {
          executionId,
          ...compileResult,
          phase: "compile",
          failureKind: classifyFailure(compileResult, "compile"),
          compilerOutput: compileResult.stderr,
        };
      }

      const command = runtime.getRunCommand ? runtime.getRunCommand(sourceFilePath, binaryPath) : runtime.command(binaryPath);
      const args = runtime.getRunArgs ? runtime.getRunArgs(sourceFilePath, binaryPath) : [];
      const result = await runProcess({ command, args, cwd: tempDir, stdin, timeoutMs: effectiveTimeout });
      return {
        executionId,
        ...result,
        phase: "run",
        failureKind: result.exitCode === 0 ? null : classifyFailure(result, "run"),
      };
    }

    const result = await runProcess({
      command: runtime.command,
      args: runtime.getArgs ? runtime.getArgs(sourceFilePath) : [sourceFilePath],
      cwd: tempDir,
      stdin,
      timeoutMs: effectiveTimeout,
    });
    return {
      executionId,
      ...result,
      phase: "run",
      failureKind: result.exitCode === 0 ? null : classifyFailure(result, "run"),
    };
  } finally {
    // Cleanup temporary workspace files asynchronously
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      logger.warn({ tempDir, err: e.message }, "Sandbox directory cleanup error");
    }
  }
}

/**
 * Execute automated test cases against candidate code
 */
async function runTestCases({ language, code, testCases = [] }) {
  const results = [];
  let allPassed = true;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const exec = await executeCodeSandbox({
      language,
      code,
      stdin: tc.input || "",
      timeoutMs: 5000,
    });

    const cleanOutput = (exec.stdout || "").trim();
    const cleanExpected = (tc.expectedOutput || "").trim();
    const passed = exec.exitCode === 0 && cleanOutput === cleanExpected;

    if (!passed) allPassed = false;

    results.push({
      testCaseIndex: i + 1,
      input: tc.isHidden ? "[Hidden Test Case]" : tc.input,
      expectedOutput: tc.isHidden ? "[Hidden]" : tc.expectedOutput,
      actualOutput: exec.stdout,
      passed,
      durationMs: exec.durationMs,
      error: exec.stderr || null,
    });
  }

  return {
    allPassed,
    results,
    passedCount: results.filter((r) => r.passed).length,
    totalCount: results.length,
  };
}

module.exports = {
  executeCodeSandbox,
  runTestCases,
  RUNTIMES,
};
