const http = require("http");
const crypto = require("crypto");
const pty = require("node-pty");

const jwt = require("jsonwebtoken");
const port = Number(process.env.PORT || 4100);
const terminals = new Map();
const maxSessions = Number(process.env.MAX_TERMINAL_SESSIONS || 50);
const maxOutputBytes = 1024 * 1024;
const JWT_SECRET = process.env.JWT_SECRET || process.env.TERMINAL_JWT_SECRET || "";

function verifyRunnerAuth(req) {
  if (!JWT_SECRET) return true; // allow when no secret configured (dev), otherwise verify
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return false;
  try {
    jwt.verify(auth.split(" ")[1], JWT_SECRET, { algorithms: ["HS256"] });
    return true;
  } catch { return false; }
}
const terminalEnvironment = Object.freeze({
  HOME: "/workspace",
  XDG_CONFIG_HOME: "/tmp/jobly-terminal/config",
  XDG_DATA_HOME: "/tmp/jobly-terminal/data",
  XDG_STATE_HOME: "/tmp/jobly-terminal/state",
  XDG_CACHE_HOME: "/tmp/jobly-terminal/cache",
  PATH: "/usr/local/bin:/usr/bin:/bin",
  TERM: "xterm-256color",
  SHELL: "/usr/bin/fish",
  COLORTERM: "truecolor",
});

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error("Request body exceeds 64KB");
  }
  return body ? JSON.parse(body) : {};
}

function getTerminal(id, response) {
  const terminal = terminals.get(id);
  if (!terminal) {
    sendJson(response, 404, { msg: "Terminal session not found" });
    return null;
  }
  return terminal;
}

function closeTerminal(id) {
  const terminal = terminals.get(id);
  if (!terminal) return;
  try {
    terminal.process.kill();
  } catch {
    // Terminal may already be closed.
  }
  terminals.delete(id);
}

const server = http.createServer(async (request, response) => {
  try {
    const path = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (request.method === "GET" && path === "/health") {
      return sendJson(response, 200, { ok: true, sessions: terminals.size });
    }
    // Require JWT for all non-health endpoints when JWT_SECRET is set
    if (JWT_SECRET && path.startsWith("/sessions") && !verifyRunnerAuth(request)) {
      return sendJson(response, 401, { msg: "Unauthorized: invalid terminal runner token" });
    }

    if (request.method === "POST" && path === "/sessions") {
      if (terminals.size >= maxSessions) return sendJson(response, 429, { msg: "Terminal capacity reached" });
      const { sessionId, cols = 80, rows = 24 } = await readBody(request);
      if (!sessionId) return sendJson(response, 400, { msg: "sessionId is required" });
      const terminalId = `term_${crypto.randomUUID()}`;
      const process = pty.spawn("/usr/bin/fish", [], {
        name: "xterm-256color",
        cols: Math.max(20, Math.min(240, Number(cols))),
        rows: Math.max(5, Math.min(100, Number(rows))),
        cwd: "/workspace",
        env: terminalEnvironment,
      });
      const terminal = { terminalId, sessionId, process, pendingOutput: "", lastActivity: Date.now() };
      process.onData((data) => {
        terminal.pendingOutput = (terminal.pendingOutput + data).slice(-maxOutputBytes);
      });
      process.onExit(() => terminals.delete(terminalId));
      terminals.set(terminalId, terminal);
      return sendJson(response, 201, { terminalId });
    }

    const match = path.match(/^\/sessions\/([^/]+)(?:\/(input|resize|output))?$/);
    if (!match) return sendJson(response, 404, { msg: "Not found" });
    const [, terminalId, action] = match;
    const terminal = getTerminal(terminalId, response);
    if (!terminal) return;
    terminal.lastActivity = Date.now();

    if (request.method === "GET" && action === "output") {
      const output = terminal.pendingOutput;
      terminal.pendingOutput = "";
      return sendJson(response, 200, { output });
    }
    if (request.method === "POST" && action === "input") {
      const { data = "" } = await readBody(request);
      if (typeof data !== "string" || data.length > 32 * 1024) return sendJson(response, 400, { msg: "Invalid terminal input" });
      terminal.process.write(data);
      return sendJson(response, 202, { ok: true });
    }
    if (request.method === "POST" && action === "resize") {
      const { cols, rows } = await readBody(request);
      terminal.process.resize(Math.max(20, Math.min(240, Number(cols))), Math.max(5, Math.min(100, Number(rows))));
      return sendJson(response, 202, { ok: true });
    }
    if (request.method === "DELETE" && !action) {
      closeTerminal(terminalId);
      return sendJson(response, 200, { ok: true });
    }
    return sendJson(response, 405, { msg: "Method not allowed" });
  } catch (error) {
    return sendJson(response, 500, { msg: error instanceof Error ? error.message : "Terminal runner error" });
  }
});

server.listen(port, "0.0.0.0");
