/**
 * yjsWebSocket.js
 *
 * Exposes two native WebSocket upgrade handlers for Yjs CRDT synchronization:
 *   - /collab/:roomKey   → coding workspace (Monaco editor)
 *   - /whiteboard/:roomKey → whiteboard (Fabric.js canvas)
 *
 * Protocol: standard Yjs binary protocol (sync step 1/2, updates, awareness).
 * Auth: JWT token passed as `?token=` query parameter.
 *
 * This module intentionally uses raw `ws` (not Socket.IO) because
 * the Yjs y-websocket client expects a bare binary WebSocket, not
 * Socket.IO's transport abstraction.
 */

const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const url = require("url");
const logger = require("../../config/logger");
const InterviewSession = require("../../models/InterviewSession");
const {
  getOrCreateRoomDoc,
  getOrCreateWhiteboardDoc,
  createSyncStep1Message,
  handleYjsMessage,
  buildAwarenessUpdate,
  buildDocUpdateMessage,
  scheduleRoomGC,
  roomDocs,
  whiteboardDocs,
  MESSAGE_AWARENESS,
} = require("./yjsCoordinator");

const awarenessProtocol = require("y-protocols/dist/awareness.cjs");
const encoding = require("lib0/dist/encoding.cjs");
const decoding = require("lib0/dist/decoding.cjs");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function sanitizeAwarenessUser(user, authName) {
  if (!user) return user;
  const clean = { ...user };
  if (authName) {
    clean.name = escapeHtml(String(authName).slice(0, 50));
  } else if (clean.name) {
    clean.name = escapeHtml(String(clean.name).slice(0, 50).replace(/<[^>]*>/g, ""));
  }
  // Only allow name and color
  const allowed = {};
  if (clean.name) allowed.name = clean.name;
  if (clean.color) allowed.color = String(clean.color).slice(0, 20);
  return allowed;
}

// ─── WebSocket Servers ──────────────────────────────────────────────────────

// Separate wss instances (noServer mode) for collab and whiteboard
const collabWss = new WebSocket.Server({ noServer: true });
const whiteboardWss = new WebSocket.Server({ noServer: true });

// ─── Auth Helper ────────────────────────────────────────────────────────────

const config = require("../../config/env");

/**
 * Validate JWT from query string and verify participant access to the session.
 * Returns the decoded token payload or throws an error.
 */
async function authenticate(rawToken, roomKey) {
  if (!rawToken) throw new Error("Missing authentication token");

  let decoded;
  const secret = config.JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("Server misconfigured: JWT_SECRET not set");
  if (process.env.NODE_ENV !== "test" && secret.length < 32) throw new Error("Server misconfigured: JWT_SECRET not set");
  try {
    decoded = jwt.verify(rawToken, secret, { algorithms: ["HS256"] });
  } catch (err) {
    throw new Error(`Invalid token: ${err.message}`);
  }

  // Verify user is a participant in this interview session — tenant-aware when present
  const seekerSessionQuery = { roomKey };
  // Note: yjs connections are per-roomKey, tenant check via session tenantId vs user? We enforce via participant check; cross-tenant roomKey guessing is mitigated by random roomKey entropy
  const session = await InterviewSession.findOne(seekerSessionQuery)
    .select("seeker recruiter additionalInterviewers status")
    .lean();

  if (!session) throw new Error("Interview room not found");

  const uid = String(decoded.id || decoded.userId || decoded._id || "");
  const seekerId = String(session.seeker?._id || session.seeker || "");
  const recruiterId = String(session.recruiter?._id || session.recruiter || "");
  const additional = (session.additionalInterviewers || []).map((id) => String(id?._id || id));

  const isParticipant =
    (seekerId && seekerId === uid) ||
    (recruiterId && recruiterId === uid) ||
    additional.includes(uid);

  if (!isParticipant) throw new Error(`Access denied: not a registered participant (${uid})`);

  return { decoded, session };
}

// ─── Core Connection Handler ─────────────────────────────────────────────────

/**
 * Wire a single authenticated WebSocket client to a Yjs room.
 *
 * @param {WebSocket} ws
 * @param {string} roomKey
 * @param {Map} docMap  - roomDocs or whiteboardDocs
 * @param {Function} getOrCreate - async function to get/create the room entry
 * @param {string} namespace  - 'collab' | 'whiteboard' for logging
 */
async function connectClientToRoom(ws, roomKey, docMap, getOrCreate, namespace) {
  let entry;
  try {
    entry = await getOrCreate(roomKey);
  } catch (err) {
    logger.error({ err: err.message, roomKey, namespace }, "Failed to get Yjs room doc");
    ws.close(1011, "Internal error initializing room");
    return;
  }

  const { doc, awareness, clients } = entry;

  // Cancel any pending GC timer since we have a new client
  if (entry.gcTimer) {
    clearTimeout(entry.gcTimer);
    entry.gcTimer = null;
  }

  clients.add(ws);
  logger.info({ roomKey, namespace, clientCount: clients.size }, "Yjs client connected");

  // ── Step 1: Send current doc state to new client ────────────────────────
  try {
    const syncMsg = createSyncStep1Message(doc);
    if (ws.readyState === WebSocket.OPEN) ws.send(syncMsg);
  } catch (err) {
    logger.warn({ err: err.message }, "Failed sending Yjs sync step 1");
  }

  // Send current awareness states of all other clients
  const awarenessStates = Array.from(awareness.getStates().keys());
  if (awarenessStates.length > 0) {
    try {
      const awarenessMsg = buildAwarenessUpdate(awareness, awarenessStates);
      if (ws.readyState === WebSocket.OPEN) ws.send(awarenessMsg);
    } catch (err) {
      logger.warn({ err: err.message }, "Failed sending awareness state");
    }
  }

  // ── Subscribe to doc updates → broadcast to other clients ────────────────
  const docUpdateHandler = (update, origin) => {
    if (origin === ws) return; // Don't echo back to sender
    try {
      const msg = buildDocUpdateMessage(update);
      clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      });
    } catch (err) {
      logger.warn({ err: err.message }, "Error broadcasting Yjs doc update");
    }
  };
  doc.on("update", docUpdateHandler);

  // ── Subscribe to awareness updates → broadcast to other clients ──────────
  const awarenessUpdateHandler = ({ added, updated, removed }) => {
    const changedClients = [...added, ...updated, ...removed];
    try {
      const msg = buildAwarenessUpdate(awareness, changedClients);
      clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      });
    } catch (err) {
      logger.warn({ err: err.message }, "Error broadcasting awareness update");
    }
  };
  awareness.on("update", awarenessUpdateHandler);

  // ── Incoming message from client ─────────────────────────────────────────
  ws.on("message", (data) => {
    try {
      let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      // Awareness spoofing defense: validate awareness user field against socket.user (only allow name from auth)
      try {
        const uint8 = new Uint8Array(buf);
        const decoder = decoding.createDecoder(uint8);
        const msgType = decoding.readVarUint(decoder);
        if (msgType === MESSAGE_AWARENESS) {
          const rawUpdate = decoding.readVarUint8Array(decoder);
          const authName = ws.user?.name || ws.decoded?.userName || ws.decoded?.name || ws.authName || null;
          const sanitizedUpdate = awarenessProtocol.modifyAwarenessUpdate(rawUpdate, (state) => {
            if (!state || typeof state !== "object") return state;
            if (!state.user) return state;
            const sanitizedUser = sanitizeAwarenessUser(state.user, authName);
            // Strip role injection and only allow safe fields
            const newState = { user: sanitizedUser };
            if (state.cursor) newState.cursor = state.cursor;
            return newState;
          });
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(enc, sanitizedUpdate);
          buf = Buffer.from(encoding.toUint8Array(enc));
        }
      } catch (awarenessErr) {
        // If sanitization fails, fall back to original buf but coordinator will sanitize again
        logger.debug({ err: awarenessErr.message }, "Awareness sanitization pre-check failed");
      }
      const response = handleYjsMessage(doc, awareness, buf, ws);
      if (response && ws.readyState === WebSocket.OPEN) {
        ws.send(response);
      }
    } catch (err) {
      logger.error({ err: err.message, roomKey }, "Error processing Yjs message from client");
    }
  });

  // ── Client disconnect ─────────────────────────────────────────────────────
  ws.on("close", () => {
    clients.delete(ws);
    doc.off("update", docUpdateHandler);
    awareness.off("update", awarenessUpdateHandler);

    // Remove this client's awareness state
    awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], "disconnect");

    logger.info({ roomKey, namespace, clientCount: clients.size }, "Yjs client disconnected");

    // Schedule GC if room is now empty
    if (clients.size === 0) {
      scheduleRoomGC(roomKey, docMap);
    }
  });

  ws.on("error", (err) => {
    logger.warn({ err: err.message, roomKey, namespace }, "Yjs WebSocket client error");
    ws.close();
  });
}

// ─── Upgrade Handler Factory ─────────────────────────────────────────────────

/**
 * Handle HTTP upgrade for coding workspace: /collab/:roomKey
 */
collabWss.on("connection", async (ws, req, roomKey) => {
  await connectClientToRoom(ws, roomKey, roomDocs, getOrCreateRoomDoc, "collab");
});

/**
 * Handle HTTP upgrade for whiteboard: /whiteboard/:roomKey
 */
whiteboardWss.on("connection", async (ws, req, roomKey) => {
  await connectClientToRoom(ws, roomKey, whiteboardDocs, getOrCreateWhiteboardDoc, "whiteboard");
});

// ─── Exported Upgrade Handler ─────────────────────────────────────────────────

/**
 * Attach to httpServer.on('upgrade', ...) in server.js.
 * Routes upgrade requests to the correct wss instance.
 */
async function handleUpgrade(req, socket, head) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const token = parsedUrl.query.token;

  // Route: /collab/:roomKey
  const collabMatch = pathname.match(/^\/collab\/([^/]+)$/);
  if (collabMatch) {
    const roomKey = collabMatch[1];
    let auth;
    try {
      auth = await authenticate(token, roomKey);
    } catch (err) {
      logger.warn({ err: err.message, roomKey }, "Yjs collab auth rejected");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    collabWss.handleUpgrade(req, socket, head, (ws) => {
      // Attach authenticated user to socket for awareness validation (only allow name from auth)
      ws.user = auth.decoded ? { ...auth.decoded, name: auth.decoded.userName || auth.decoded.name || auth.decoded.id } : null;
      ws.decoded = auth.decoded;
      ws.authName = auth.decoded?.userName || auth.decoded?.name || null;
      ws.session = auth.session;
      collabWss.emit("connection", ws, req, roomKey);
    });
    return;
  }

  // Route: /whiteboard/:roomKey
  const whiteboardMatch = pathname.match(/^\/whiteboard\/([^/]+)$/);
  if (whiteboardMatch) {
    const roomKey = whiteboardMatch[1];
    let auth;
    try {
      auth = await authenticate(token, roomKey);
    } catch (err) {
      logger.warn({ err: err.message, roomKey }, "Yjs whiteboard auth rejected");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    whiteboardWss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = auth.decoded ? { ...auth.decoded, name: auth.decoded.userName || auth.decoded.name || auth.decoded.id } : null;
      ws.decoded = auth.decoded;
      ws.authName = auth.decoded?.userName || auth.decoded?.name || null;
      ws.session = auth.session;
      whiteboardWss.emit("connection", ws, req, roomKey);
    });
    return;
  }

  // Not a Yjs route — let caller handle it (e.g., Socket.IO)
  return false;
}

module.exports = { handleUpgrade };
