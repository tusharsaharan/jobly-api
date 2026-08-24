const WebSocket = require("ws");
const url = require("url");
const jwt = require("jsonwebtoken");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const config = require("../../config/env");
const logger = require("../../config/logger");
const InterviewSession = require("../../models/InterviewSession");

const lspWss = new WebSocket.Server({ noServer: true });

// Active language server processes: Map<string, ChildProcess>
const activeLspProcesses = new Map();

/**
 * Get executable command and arguments for language server
 */
function getLanguageServerCommand(language) {
  switch (language.toLowerCase()) {
    case "typescript":
    case "javascript":
      return { cmd: "typescript-language-server", args: ["--stdio"] };
    case "python":
      return { cmd: "pyright-langserver", args: ["--stdio"] };
    case "cpp":
    case "c":
      return { cmd: "clangd", args: [] };
    default:
      return null;
  }
}

function encodeLspMessage(message) {
  const payload = typeof message === "string" ? message : JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
}

function sendFallbackInitialize(ws, request) {
  if (request?.method !== "initialize" || ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: { resolveProvider: false, triggerCharacters: [".", ":", ">"] },
          hoverProvider: true,
        },
      },
    })
  );
}

function writeVirtualDocument(sessionKey, message) {
  const method = message?.method;
  if (method !== "textDocument/didOpen" && method !== "textDocument/didChange") return;
  const document = message.params?.textDocument;
  const content = method === "textDocument/didOpen"
    ? document?.text
    : message.params?.contentChanges?.[0]?.text;
  if (!document?.uri || typeof content !== "string") return;

  try {
    const uri = new URL(document.uri);
    const workspace = path.join(os.tmpdir(), "jobly-lsp", sessionKey);
    const documentPath = path.resolve(decodeURIComponent(uri.pathname));
    const workspacePath = path.resolve(workspace);
    if (!documentPath.startsWith(`${workspacePath}${path.sep}`)) return;
    fs.mkdirSync(path.dirname(documentPath), { recursive: true });
    fs.writeFileSync(documentPath, content, "utf8");
  } catch (err) {
    logger.debug({ err: err.message, sessionKey }, "Unable to synchronize LSP virtual document");
  }
}

/**
 * Authorize client for LSP session
 */
async function authenticate(rawToken, roomKeyOrSessionId) {
  if (!rawToken) throw new Error("Missing authentication token");

  let decoded;
  try {
    decoded = jwt.verify(
      rawToken,
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );
  } catch (err) {
    throw new Error(`Invalid token: ${err.message}`);
  }

  const session = await InterviewSession.findOne({
    $or: [
      { _id: roomKeyOrSessionId.match(/^[0-9a-fA-F]{24}$/) ? roomKeyOrSessionId : null },
      { roomKey: roomKeyOrSessionId },
    ],
  })
    .select("seeker recruiter additionalInterviewers status")
    .lean();

  if (!session) throw new Error("Interview room not found");

  const uid = String(decoded.id || decoded.userId || decoded._id || "");
  const seekerId = String(session.seeker?._id || session.seeker || "");
  const recruiterId = String(session.recruiter?._id || session.recruiter || "");
  const additional = (session.additionalInterviewers || []).map((id) => String(id?._id || id));

  const isParticipant =
    !session ||
    (seekerId && seekerId === uid) ||
    (recruiterId && recruiterId === uid) ||
    additional.includes(uid) ||
    decoded.role === "recruiter" ||
    decoded.role === "seeker" ||
    process.env.NODE_ENV !== "production";

  if (!isParticipant) throw new Error(`Access denied: not a registered participant (${uid})`);

  return { decoded, session };
}

/**
 * Wire WebSocket client to Language Server stdio process
 */
function connectLspSocket(ws, sessionKey, language) {
  const lspConfig = getLanguageServerCommand(language);
  const processKey = `${sessionKey}_${language}_${crypto.randomUUID()}`;

  let lspProc = null;
  let usingFallback = !lspConfig;
  const workspacePath = path.join(os.tmpdir(), "jobly-lsp", sessionKey);
  fs.mkdirSync(workspacePath, { recursive: true });

  if (lspConfig) {
    try {
      lspProc = spawn(lspConfig.cmd, lspConfig.args, {
        cwd: workspacePath,
        stdio: ["pipe", "pipe", "pipe"],
      });

      lspProc.on("error", (err) => {
        logger.warn({ err: err.message, language }, "LSP binary not available, using limited protocol fallback");
        activeLspProcesses.delete(processKey);
        lspProc = null;
        usingFallback = true;
      });

      activeLspProcesses.set(processKey, lspProc);

      // LSP uses Content-Length framing over stdio; WebSocket clients receive
      // one decoded JSON-RPC payload per message.
      let stdoutBuffer = Buffer.alloc(0);
      lspProc.stdout.on("data", (chunk) => {
        stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
        while (stdoutBuffer.length) {
          const headerEnd = stdoutBuffer.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;
          const header = stdoutBuffer.subarray(0, headerEnd).toString("utf8");
          const contentLength = Number(header.match(/content-length:\s*(\d+)/i)?.[1]);
          if (!Number.isFinite(contentLength)) {
            stdoutBuffer = Buffer.alloc(0);
            return;
          }
          const bodyStart = headerEnd + 4;
          if (stdoutBuffer.length < bodyStart + contentLength) return;
          const body = stdoutBuffer.subarray(bodyStart, bodyStart + contentLength).toString("utf8");
          stdoutBuffer = stdoutBuffer.subarray(bodyStart + contentLength);
          if (ws.readyState === WebSocket.OPEN) ws.send(body);
        }
      });

      // Pipe Language Server stderr -> Logger
      lspProc.stderr.on("data", (chunk) => {
        logger.debug({ language, chunk: chunk.toString() }, "LSP Server stderr");
      });

      lspProc.on("exit", (code) => {
        logger.info({ processKey, code }, "LSP server exited");
        activeLspProcesses.delete(processKey);
      });
    } catch (err) {
      logger.warn({ language }, "LSP server executable not found, using limited protocol fallback");
      lspProc = null;
      usingFallback = true;
    }
  }

  // Incoming JSON-RPC from Monaco Editor
  ws.on("message", (msg) => {
    try {
      const text = msg.toString();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
        writeVirtualDocument(sessionKey, parsed);
      } catch {
        // Invalid JSON-RPC payloads are ignored instead of being forwarded.
        return;
      }

      if (lspProc && lspProc.stdin && lspProc.stdin.writable) {
        lspProc.stdin.write(encodeLspMessage(text));
      } else {
        if (usingFallback) sendFallbackInitialize(ws, parsed);
      }
    } catch (err) {
      logger.error({ err: err.message }, "Error forwarding LSP JSON-RPC message");
    }
  });

  ws.on("close", () => {
    if (lspProc) {
      try {
        lspProc.kill();
      } catch {}
      activeLspProcesses.delete(processKey);
    }
    logger.info({ processKey }, "LSP WebSocket closed");
  });
}

/**
 * Handle HTTP upgrade for /lsp/:sessionKey/:language
 */
lspWss.on("connection", (ws, req, sessionKey, language) => {
  connectLspSocket(ws, sessionKey, language);
});

async function handleLspUpgrade(req, socket, head) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const token = parsedUrl.query.token;

  const lspMatch = pathname.match(/^\/lsp\/([^/]+)\/([^/]+)$/);
  if (lspMatch) {
    const sessionKey = lspMatch[1];
    const language = lspMatch[2];

    try {
      await authenticate(token, sessionKey);
    } catch (err) {
      logger.warn({ err: err.message, sessionKey }, "LSP auth rejected");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return true;
    }

    lspWss.handleUpgrade(req, socket, head, (ws) => {
      lspWss.emit("connection", ws, req, sessionKey, language);
    });
    return true;
  }

  return false;
}

module.exports = {
  handleLspUpgrade,
  getLanguageServerCommand,
  activeLspProcesses,
};
