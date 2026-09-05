const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const logger = require("../../config/logger");

// Active terminal instances: Map<terminalId, TerminalSession>
// TerminalSession = { terminalId, sessionId, ptyProcess, history: [], lastActivity: number }
const activeTerminals = new Map();
const terminalRunnerUrl = process.env.TERMINAL_RUNNER_URL;

function getRunnerAuthHeader() {
  try {
    const config = require("../../config/env");
    const secret = config.JWT_SECRET;
    if (!secret || secret.length < 10) return {};
    const jwt = require("jsonwebtoken");
    const token = jwt.sign({ service: "jobly-api" }, secret, { expiresIn: "5m" });
    return { Authorization: `Bearer ${token}` };
  } catch { return {}; }
}

async function callRunner(path, method = "GET", body) {
  const authHeader = getRunnerAuthHeader();
  const headers = { ...authHeader, ...(body ? { "Content-Type": "application/json" } : {}) };
  const response = await fetch(`${terminalRunnerUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.msg || `Terminal runner request failed (${response.status})`);
  return payload;
}

/**
 * Get OS shell command
 */
function getDefaultShell() {
  if (os.platform() === "win32") {
    return process.env.COMSPEC || "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

/**
 * Create a new pseudo-terminal session for an interview
 */
function createTerminalSession(sessionId, cols = 80, rows = 24, onDataCallback) {
  // Tests are hermetic: never reach a real runner even if TERMINAL_RUNNER_URL
  // is present in the environment (demo .env sets it).
  if (process.env.NODE_ENV === "test") {
    // Allow in-memory pty for unit tests but with restricted env/cwd
    const terminalId = `term_${crypto.randomUUID()}`;
    const sessionEntry = {
      terminalId,
      sessionId,
      history: [],
      lastActivity: Date.now(),
      remote: false,
      ptyProcess: {
        write: (data) => {
          if (onDataCallback) onDataCallback(terminalId, data);
          sessionEntry.history.push(data);
        },
        stdin: { writable: true, write: (d) => { if (onDataCallback) onDataCallback(terminalId, d); } },
        kill: () => {},
        resize: () => true,
      },
    };
    activeTerminals.set(terminalId, sessionEntry);
    logger.info({ terminalId, sessionId }, "Test terminal session created (restricted)");
    return terminalId;
  }
  if (terminalRunnerUrl) return createRemoteTerminalSession(sessionId, cols, rows, onDataCallback);
  throw new Error("Interactive terminal is unavailable: TERMINAL_RUNNER_URL is not configured. Refusing to expose a host shell.");
}

async function createRemoteTerminalSession(sessionId, cols, rows, onDataCallback) {
  const { terminalId } = await callRunner("/sessions", "POST", { sessionId, cols, rows });
  const sessionEntry = {
    terminalId,
    sessionId,
    remote: true,
    history: [],
    lastActivity: Date.now(),
    onDataCallback,
    pollTimer: null,
  };
  const pollOutput = async () => {
    if (!activeTerminals.has(terminalId)) return;
    try {
      const { output } = await callRunner(`/sessions/${terminalId}/output`);
      if (output && sessionEntry.onDataCallback) sessionEntry.onDataCallback(terminalId, output);
    } catch (err) {
      logger.warn({ terminalId, err: err.message }, "Terminal runner output poll failed");
      closeTerminalSession(terminalId);
    }
  };
  sessionEntry.pollTimer = setInterval(pollOutput, 200);
  sessionEntry.pollTimer.unref?.();
  activeTerminals.set(terminalId, sessionEntry);
  await pollOutput();
  logger.info({ terminalId, sessionId }, "Containerized terminal session created");
  return terminalId;
}

/**
 * Write input data to the terminal stream
 */
function writeToTerminal(terminalId, data) {
  const session = activeTerminals.get(terminalId);
  if (!session) {
    throw new Error(`Terminal ${terminalId} not found`);
  }

  session.lastActivity = Date.now();

  if (session.remote) {
    return callRunner(`/sessions/${terminalId}/input`, "POST", { data });
  }

  if (session.ptyProcess.write) {
    session.ptyProcess.write(data);
  } else if (session.ptyProcess.stdin && session.ptyProcess.stdin.writable) {
    session.ptyProcess.stdin.write(data);
  }
}

/**
 * Resize terminal viewport dimensions
 */
function resizeTerminal(terminalId, cols, rows) {
  const session = activeTerminals.get(terminalId);
  if (!session) {
    throw new Error(`Terminal ${terminalId} not found`);
  }

  session.lastActivity = Date.now();

  if (session.remote) {
    return callRunner(`/sessions/${terminalId}/resize`, "POST", { cols, rows }).then(() => true);
  }

  if (session.ptyProcess.resize) {
    session.ptyProcess.resize(cols, rows);
    return true;
  }
  return false;
}

/**
 * Terminate a terminal session
 */
function closeTerminalSession(terminalId) {
  const session = activeTerminals.get(terminalId);
  if (!session) return;

  if (session.pollTimer) clearInterval(session.pollTimer);

  if (session.remote) {
    activeTerminals.delete(terminalId);
    return callRunner(`/sessions/${terminalId}`, "DELETE").catch((err) => {
      logger.warn({ err: err.message, terminalId }, "Error closing containerized terminal");
    });
  }

  try {
    if (session.ptyProcess.kill) {
      session.ptyProcess.kill();
    }
  } catch (err) {
    logger.warn({ err: err.message, terminalId }, "Error killing terminal process");
  }

  activeTerminals.delete(terminalId);
  logger.info({ terminalId }, "Terminal session closed");
}

/**
 * Get active terminal entry
 */
function getTerminalSession(terminalId) {
  return activeTerminals.get(terminalId) || null;
}

function getTerminalForSession(sessionId) {
  for (const session of activeTerminals.values()) {
    if (session.sessionId === String(sessionId)) return session;
  }
  return null;
}

module.exports = {
  createTerminalSession,
  writeToTerminal,
  resizeTerminal,
  closeTerminalSession,
  getTerminalSession,
  getTerminalForSession,
  activeTerminals,
};
