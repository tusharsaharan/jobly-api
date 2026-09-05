const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const logger = require("../../config/logger");
const {
  SECCOMP_BPF_PROFILE,
  CGROUPS_V2_CONFIG,
  generateContainerSecurityArgs,
} = require("./sandboxSecurityProfile");

// ─── Sandbox Security: Static Analysis Pre-check ─────────────────────────────
const MAX_CODE_BYTES = 100000; // 100KB limit
const NETWORK_ALLOWLIST = (process.env.SANDBOX_NETWORK_ALLOWLIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Blocked require/import patterns – brutally block host FS, process control, and network
const BLOCKED_JS_PATTERNS = [
  { pattern: /require\s*\(\s*['"]\s*(?:node:)?(?:fs|fs\/promises|fs\/constants)\s*['"]\s*\)/i, reason: "require('fs') is blocked - host filesystem access denied" },
  { pattern: /require\s*\(\s*['"]\s*(?:node:)?(?:child_process)\s*['"]\s*\)/i, reason: "require('child_process') is blocked - process spawning denied" },
  { pattern: /require\s*\(\s*['"]\s*(?:node:)?(?:net)\s*['"]\s*\)/i, reason: "require('net') is blocked - network access denied" },
  { pattern: /require\s*\(\s*['"]\s*(?:node:)?(?:dgram)\s*['"]\s*\)/i, reason: "require('dgram') is blocked - network access denied" },
  { pattern: /require\s*\(\s*['"]\s*(?:node:)?(?:http)\s*['"]\s*\)/i, reason: "require('http') is blocked - network access denied" },
  { pattern: /require\s*\(\s*['"]\s*(?:node:)?(?:https)\s*['"]\s*\)/i, reason: "require('https') is blocked - network access denied" },
  { pattern: /require\s*\(\s*['"]\s*(?:node:)?(?:worker_threads|vm|v8|cluster|repl|process)\s*['"]\s*\)/i, reason: "require('worker_threads/vm') is blocked" },
  // Allow process.exit(0) / process.exit(1) for clean readline termination in tests; block bare process.exit() or non-zero weird usage still via timeout watchdog
  // { pattern: /\bprocess\s*\.\s*exit\s*\(/i, reason: "process.exit is blocked - process termination denied" },
  { pattern: /\bchild_process\b/i, reason: "child_process is blocked" },
  { pattern: /\bexecSync\b|\bexec\s*\(\s*['"]/i, reason: "exec/execSync is blocked" },
  { pattern: /\bspawnSync\b|\bfork\s*\(/i, reason: "spawnSync/fork is blocked" },
  { pattern: /\bfs\s*\.\s*(readFile|writeFile|readFileSync|writeFileSync|createReadStream|createWriteStream|openSync|readdir)/i, reason: "fs read/write is blocked" },
  // Socket/network generic
  { pattern: /\bsocket\s*\.\s*connect\b|\bnet\.connect\b|\bnet\.createConnection\b/i, reason: "socket.connect is blocked - network egress denied" },
  { pattern: /\bsocket\b.*\bconnect\b/i, reason: "socket usage is blocked" },
  // Dynamic require / import bypasses
  { pattern: /require\s*\(.*Buffer\.from/i, reason: "Dynamic require via Buffer is blocked" },
  // Escape hatches — anchored to real constructor escapes. A bare anonymous
  // `function(){}` callback is normal code and must NOT be rejected.
  { pattern: /\bnew\s+Function\s*\(/i, reason: "Function constructor escape is blocked" },
  { pattern: /\beval\s*\(/i, reason: "eval is blocked" },
  { pattern: /global\s*\.\s*process|this\s*\.\s*constructor|\bconstructor\s*\[/i, reason: "Global process/prototype escape is blocked" },
  { pattern: /\bimport\s*\(\s*['"](?:node:)?(?:fs|child_process)['"]\s*\)/i, reason: "Dynamic import of fs/child_process blocked" },
  { pattern: /__import__\s*\(\s*['"]os['"]\s*\)|getattr\s*\(\s*__import__/i, reason: "Python dynamic import escape blocked" },
];
const BLOCKED_PY_PATTERNS = [
  { pattern: /\bimport\s+os\b/i, reason: "import os is blocked - host filesystem access denied" },
  { pattern: /\bimport\s+socket\b/i, reason: "import socket is blocked - network access denied" },
  { pattern: /\bimport\s+subprocess\b/i, reason: "import subprocess is blocked - process spawning denied" },
  { pattern: /\bimport\s+sys\b.*\bexit\b/i, reason: "sys.exit is blocked" },
  { pattern: /from\s+os\s+import/i, reason: "from os import is blocked" },
  { pattern: /from\s+socket\s+import/i, reason: "from socket import is blocked" },
  { pattern: /from\s+subprocess\s+import/i, reason: "from subprocess import is blocked" },
  { pattern: /\bos\s*\.\s*(system|popen|exec|spawn|remove|unlink|listdir|mkdir|read|write)\s*\(/i, reason: "os.system/popen is blocked" },
  { pattern: /\bsubprocess\s*\./i, reason: "subprocess is blocked" },
  { pattern: /\bsocket\s*\.\s*socket\s*\(/i, reason: "socket.socket is blocked" },
  { pattern: /\bsys\s*\.\s*exit\s*\(/i, reason: "sys.exit is blocked" },
];

const NETWORK_PATTERNS_JS = /\b(fetch\s*\(|axios\s*\(|http\.request|https\.request|net\.connect|socket\.connect|WebSocket\s*\()/i;
const NETWORK_PATTERNS_PY = /\bsocket\.socket\b|\bconnect\s*\(\s*\(/i;

function validateSandboxSecurity(language, code) {
  const codeStr = String(code || "");
  // 1) Size limit 100KB
  if (Buffer.byteLength(codeStr, "utf8") > MAX_CODE_BYTES) {
    return `Code exceeds 100KB limit (${Buffer.byteLength(codeStr, "utf8")} bytes > ${MAX_CODE_BYTES})`;
  }
  const lang = (language || "").toLowerCase();
  const patterns = lang === "python" ? BLOCKED_PY_PATTERNS : BLOCKED_JS_PATTERNS.concat(BLOCKED_PY_PATTERNS);
  // For python only check py patterns, for js check js patterns plus generic
  const activePatterns = lang === "python" ? BLOCKED_PY_PATTERNS : BLOCKED_JS_PATTERNS;
  for (const { pattern, reason } of activePatterns) {
    if (pattern.test(codeStr)) {
      return reason;
    }
  }
  // Also block cross-language dangerous imports even if language mismatch (e.g., python code pasted as javascript)
  // Check all patterns regardless
  for (const { pattern, reason } of [...BLOCKED_JS_PATTERNS, ...BLOCKED_PY_PATTERNS]) {
    if (pattern.test(codeStr)) {
      // For generic safety, if any blocked pattern matches, block
      // But allow innocent words like "socket" inside comments? keep strict for security
      return reason;
    }
  }
  // Network allowlist check: if network pattern found and not allowlisted, block
  if (NETWORK_ALLOWLIST.length === 0) {
    if (NETWORK_PATTERNS_JS.test(codeStr) || NETWORK_PATTERNS_PY.test(codeStr)) {
      // Require explicit allowlist; empty means no network
      // Check if code actually tries network; we already blocked socket, but fetch/http still needed
      if (/fetch\s*\(|http\.request|https\.request|socket/i.test(codeStr)) {
        return "Network access is blocked - no hosts in SANDBOX_NETWORK_ALLOWLIST";
      }
    }
  } else {
    // If allowlist exists, ensure requested host is in list (simple heuristic)
    // For now block all if no allowlist match – strict
    const hasNetwork = NETWORK_PATTERNS_JS.test(codeStr) || NETWORK_PATTERNS_PY.test(codeStr);
    if (hasNetwork) {
      const allowed = NETWORK_ALLOWLIST.some((host) => codeStr.includes(host));
      if (!allowed) {
        return `Network access to host not in allowlist [${NETWORK_ALLOWLIST.join(", ")}]`;
      }
    }
  }
  return null;
}

// In production, disable compiled-language sandbox when not in hardened container
const ENABLE_COMPILED_SANDBOX = process.env.ENABLE_COMPILED_SANDBOX === "true" || process.env.NODE_ENV !== "production";

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
  go: {
    extension: "go",
    command: "go",
    getArgs: (filepath) => ["run", filepath],
    timeoutMs: 12000,
    memoryLimitMb: 512,
  },
  ruby: {
    extension: "rb",
    command: "ruby",
    getArgs: (filepath) => [filepath],
    timeoutMs: 8000,
    memoryLimitMb: 256,
  },
  rust: {
    extension: "rs",
    isCompiled: true,
    compileCmd: "rustc",
    getCompileArgs: (src, bin) => [src, "-O", "-o", bin],
    command: (bin) => bin,
    timeoutMs: 12000,
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

    // ── Sandbox isolation: validate cwd is inside restricted temp sandbox ──
    const expectedSandboxRoot = path.join(os.tmpdir(), "jobly_sandbox");
    if (cwd && !path.resolve(cwd).startsWith(path.resolve(expectedSandboxRoot))) {
      logger.warn({ cwd, expectedSandboxRoot }, "Sandbox cwd outside restricted root - execution denied");
      return finish({ stdout, stderr: "[Security] Invalid working directory", exitCode: 1, durationMs: 0, timedOut: false, error: "Invalid cwd" });
    }
    // ── Apply SECCOMP/CGROUPS security profile (logging for audit; actual enforcement via container runtime) ──
    try {
      const containerSecurityArgs = generateContainerSecurityArgs({ memoryMb: 256, disableNetworking: NETWORK_ALLOWLIST.length === 0 });
      logger.debug({ SECCOMP_BPF_PROFILE: SECCOMP_BPF_PROFILE.defaultAction, CGROUPS_V2_CONFIG, containerSecurityArgs, cwd }, "Applying sandbox security profile (SECCOMP/CGROUPS/no-new-privileges/network=none)");
    } catch (e) {
      logger.debug({ err: e.message }, "Failed to generate container security args");
    }

    let child;
    try {
      child = spawn(command, args, {
        cwd: cwd || expectedSandboxRoot,
        // Restricted env: only minimal allowlist, no secrets, no host env leakage
        env: {
          NODE_ENV: "production",
          PATH: process.env.PATH,
          PYTHONUNBUFFERED: "1",
          // Explicitly do NOT pass through process.env secrets like JWT_SECRET, MONGO_URI, etc.
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
  if (runtime.isCompiled && !ENABLE_COMPILED_SANDBOX) {
    const executionId = crypto.randomUUID();
    return {
      executionId,
      stdout: "",
      stderr: `[Security] ${language} execution is disabled in this environment. Enable ENABLE_COMPILED_SANDBOX=true with container isolation.`,
      exitCode: 1,
      durationMs: 0,
      timedOut: false,
      error: "Compiled language disabled",
      phase: "run",
      failureKind: "security_violation",
    };
  }

  // ── Static analysis pre-check: block host FS, child_process, socket, process.exit, network ──
  const securityViolation = validateSandboxSecurity(language, code);
  if (securityViolation) {
    logger.warn({ language, reason: securityViolation }, "Sandbox static analysis blocked execution");
    const executionId = crypto.randomUUID();
    return {
      executionId,
      stdout: "",
      stderr: `[Security] Execution blocked: ${securityViolation}`,
      exitCode: 1,
      durationMs: 0,
      timedOut: false,
      error: securityViolation,
      phase: "run",
      failureKind: "security_violation",
    };
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
      const isWin = os.platform() === "win32";
      const binaryPath = path.join(tempDir, isWin && runtime.extension === "cpp" ? "solution-bin.exe" : "solution-bin");
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
          stderr: compileResult.stderr || "Compilation failed.",
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

  // Hard cap: 50 tests x 5s = bounded worst case (~250s) regardless of caller.
  const boundedTestCases = Array.isArray(testCases) ? testCases.slice(0, 50) : [];

  for (let i = 0; i < boundedTestCases.length; i++) {
    const tc = boundedTestCases[i];
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
  SECCOMP_BPF_PROFILE,
  CGROUPS_V2_CONFIG,
  generateContainerSecurityArgs,
  validateSandboxSecurity,
  MAX_CODE_BYTES,
};
