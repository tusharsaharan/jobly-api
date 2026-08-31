const Y = require("yjs");
const syncProtocol = require("y-protocols/dist/sync.cjs");
const awarenessProtocol = require("y-protocols/dist/awareness.cjs");
const encoding = require("lib0/dist/encoding.cjs");
const decoding = require("lib0/dist/decoding.cjs");
const path = require("path");
const logger = require("../../config/logger");
const InterviewSession = require("../../models/InterviewSession");

// Message type constants (Yjs protocol)
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// In-memory active Yjs docs: Map<roomKey, RoomEntry>
// RoomEntry = { doc, awareness, filesMap, subscribers, persistTimer, lastPersisted }
const roomDocs = new Map();

// Separate map for whiteboard docs: Map<sessionId, WhiteboardEntry>
const whiteboardDocs = new Map();

// Debounce duration for persistence writes (ms)
const PERSIST_DEBOUNCE_MS = 3000;

// TTL before cleaning up empty rooms (ms)
const ROOM_GC_DELAY_MS = 30 * 60 * 1000; // 30 minutes

const MAX_YTEXT_SIZE = 100000; // 100KB limit for Y.Text

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUserName(name) {
  return escapeHtml(String(name || "").slice(0, 50).replace(/<[^>]*>/g, ""));
}

// Enforce 100KB Y.Text size limit by truncating oversized texts
function enforceYTextSizeLimit(doc) {
  let violated = false;
  for (const [key, type] of doc.share.entries()) {
    if (type instanceof Y.Text) {
      if (type.length > MAX_YTEXT_SIZE) {
        logger.warn({ key, size: type.length }, "Y.Text exceeds 100KB, truncating");
        doc.transact(() => {
          type.delete(MAX_YTEXT_SIZE, type.length - MAX_YTEXT_SIZE);
        }, "size-limit-enforcement");
        violated = true;
      }
    }
  }
  return !violated;
}

function sanitizeAwarenessUpdate(update, origin) {
  try {
    const authName = origin?.user?.name || origin?.decoded?.userName || origin?.decoded?.name || origin?.authName || null;
    return awarenessProtocol.modifyAwarenessUpdate(update, (state) => {
      if (!state || typeof state !== "object") return state;
      if (!state.user) return state;
      const sanitized = { ...state };
      let user = { ...state.user };
      // Only allow name from auth, sanitize color
      if (authName) {
        user.name = sanitizeUserName(authName);
      } else if (user.name) {
        // Sanitize but do not trust arbitrary name
        user.name = sanitizeUserName(user.name);
        // Block script injection
        if (/<script/i.test(String(state.user.name))) {
          user.name = user.name.replace(/<[^>]*>/g, "");
        }
      }
      // Only allow known fields: name, color
      const allowedUser = {};
      if (user.name) allowedUser.name = String(user.name).slice(0, 50);
      if (user.color) allowedUser.color = String(user.color).slice(0, 20);
      sanitized.user = allowedUser;
      // Strip any other top-level fields that could be abused (role, etc.)
      const allowedState = { user: sanitized.user };
      if (state.cursor) allowedState.cursor = state.cursor;
      // Preserve cursor/selection but not role injection
      return allowedState;
    });
  } catch (e) {
    logger.warn({ err: e.message }, "Failed to sanitize awareness update");
    return update;
  }
}

function sanitizeFilesystemPaths(doc) {
  try {
    const filesystem = doc.getMap("filesystem");
    if (!filesystem || filesystem.size === 0) return;
    const keys = Array.from(filesystem.keys());
    for (const key of keys) {
      let decoded = key;
      try {
        decoded = decodeURIComponent(key);
      } catch (_) {
        // If fails, treat as encoded traversal
        decoded = key;
      }
      // Double-decode check
      try {
        const double = decodeURIComponent(decoded);
        if (double !== decoded) decoded = double;
      } catch (_) {}
      const normalized = path.posix.normalize(decoded.startsWith("/") ? decoded : `/${decoded}`);
      const hasTraversal = decoded.includes("..") || decoded.includes("\0") || decoded.includes("\\") || normalized.includes("..") || !normalized.startsWith("/");
      const isNotNormalized = key !== normalized;
      if (hasTraversal || isNotNormalized) {
        // If key contains traversal or is not normalized, remove malicious entry
        if (hasTraversal) {
          logger.warn({ key, decoded, normalized }, "Removing filesystem entry with path traversal");
          doc.transact(() => {
            filesystem.delete(key);
            try {
              const ytext = doc.getText(key);
              ytext.delete(0, ytext.length);
            } catch (_) {}
          }, "sanitize-filesystem");
        }
      }
    }
  } catch (e) {
    logger.debug({ err: e.message }, "sanitizeFilesystemPaths failed");
  }
}

const MAX_WHITEBOARD_ELEMENTS = 3000;
const MAX_WHITEBOARD_TOTAL_SIZE = 500 * 1024;
const MAX_WHITEBOARD_ELEMENT_SIZE = 20 * 1024;

function enforceWhiteboardSizeLimit(doc) {
  try {
    const map = doc.getMap("excalidraw-elements");
    if (!map || map.size === 0) return;
    if (map.size > MAX_WHITEBOARD_ELEMENTS) {
      logger.warn({ size: map.size, limit: MAX_WHITEBOARD_ELEMENTS }, "Whiteboard element count exceeds limit");
      // Truncate oldest entries if exceeds limit (delete excess)
      const keys = Array.from(map.keys());
      const excess = map.size - MAX_WHITEBOARD_ELEMENTS;
      if (excess > 0) {
        doc.transact(() => {
          for (let i = 0; i < excess; i++) map.delete(keys[i]);
        }, "whiteboard-size-limit");
      }
    }
    let totalSize = 0;
    const oversized = [];
    for (const [k, v] of map.entries()) {
      const s = String(v).length;
      totalSize += s;
      if (s > MAX_WHITEBOARD_ELEMENT_SIZE) oversized.push(k);
    }
    if (oversized.length > 0) {
      logger.warn({ oversized: oversized.length }, "Whiteboard has oversized elements, removing");
      doc.transact(() => {
        for (const k of oversized) map.delete(k);
      }, "whiteboard-size-limit");
    }
    if (totalSize > MAX_WHITEBOARD_TOTAL_SIZE) {
      logger.warn({ totalSize, limit: MAX_WHITEBOARD_TOTAL_SIZE }, "Whiteboard total size exceeds limit, truncating");
      // Remove oldest until under limit
      const keys = Array.from(map.keys());
      let curSize = totalSize;
      doc.transact(() => {
        for (const k of keys) {
          if (curSize <= MAX_WHITEBOARD_TOTAL_SIZE) break;
          const v = map.get(k);
          curSize -= String(v).length;
          map.delete(k);
        }
      }, "whiteboard-size-limit");
    }
  } catch (e) {
    logger.debug({ err: e.message }, "enforceWhiteboardSizeLimit failed");
  }
}

/**
 * Load persisted Yjs state from MongoDB and apply to doc
 */
async function loadPersistedState(doc, sessionIdentifier, field) {
  try {
    const isObjId = /^[0-9a-fA-F]{24}$/.test(String(sessionIdentifier));
    const session = await InterviewSession.findOne(
      isObjId
        ? { $or: [{ roomKey: sessionIdentifier }, { _id: sessionIdentifier }] }
        : { roomKey: sessionIdentifier }
    ).select(field).lean();

    if (session && session[field] && session[field].length > 2) {
      try {
        Y.applyUpdate(doc, new Uint8Array(session[field]));
        logger.debug({ sessionIdentifier, field }, "Loaded persisted Yjs state from MongoDB");
      } catch (applyErr) {
        logger.warn({ sessionIdentifier, field, err: applyErr.message }, "Skipping unparseable persisted Yjs state buffer");
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, sessionIdentifier }, "Could not load persisted Yjs state");
  }
}

/**
 * Persist current Yjs doc state to MongoDB (debounced)
 */
function schedulePersist(roomKey, doc, field) {
  const entry = roomDocs.get(roomKey) || whiteboardDocs.get(roomKey);
  if (!entry) return;

  if (entry.persistTimer) clearTimeout(entry.persistTimer);

  entry.persistTimer = setTimeout(async () => {
    await persistRoomDocNow(roomKey, doc, field);
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Flush Yjs state immediately to MongoDB
 */
async function persistRoomDocNow(roomKey, doc, field = "yjsState") {
  try {
    const state = Y.encodeStateAsUpdate(doc);
    await InterviewSession.findOneAndUpdate(
      { roomKey },
      { $set: { [field]: Buffer.from(state) } }
    );
    const entry = roomDocs.get(roomKey) || whiteboardDocs.get(roomKey);
    if (entry) entry.lastPersisted = Date.now();
    logger.debug({ roomKey, field }, "Persisted Yjs state to MongoDB immediately");
  } catch (err) {
    logger.warn({ err: err.message, roomKey }, "Failed to persist Yjs state");
  }
}

const roomCreationLocks = new Map();
const whiteboardCreationLocks = new Map();

/**
 * Get or initialize Yjs document for the coding workspace of an interview session.
 * On first creation, loads persisted state from MongoDB.
 * Brutal fix: serialize creation per roomKey to prevent duplicate docs under concurrent two-user access.
 */
async function getOrCreateRoomDoc(roomKey) {
  if (roomDocs.has(roomKey)) return roomDocs.get(roomKey);
  if (roomCreationLocks.has(roomKey)) {
    await roomCreationLocks.get(roomKey);
    if (roomDocs.has(roomKey)) return roomDocs.get(roomKey);
  }
  let release;
  const lock = new Promise((resolve) => (release = resolve));
  roomCreationLocks.set(roomKey, lock);
  try {
    if (roomDocs.has(roomKey)) return roomDocs.get(roomKey);
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);

    // Load persisted state before exposing to clients
    await loadPersistedState(doc, roomKey, "yjsState");

    // Initialize default filesystem structure if brand new
    const filesystem = doc.getMap("filesystem");
    if (filesystem.size === 0) {
      doc.transact(() => {
        filesystem.set("/solution.py", {
          type: "file",
          name: "solution.py",
          path: "/solution.py",
          language: "python",
        });
        // Seed initial content into Y.Text
        const ytext = doc.getText("/solution.py");
        if (ytext.length === 0) {
          ytext.insert(0, "# Write your solution below\n\ndef solution():\n    pass\n");
        }
      });
    }

    const entry = {
      doc,
      awareness,
      clients: new Set(), // Set<WebSocket>
      persistTimer: null,
      lastPersisted: Date.now(),
      gcTimer: null,
    };

    // Persist on every Yjs update
    doc.on("update", (update, origin) => {
      if (origin !== "size-limit-enforcement" && origin !== "sanitize-filesystem" && origin !== "whiteboard-size-limit") {
        enforceYTextSizeLimit(doc);
        sanitizeFilesystemPaths(doc);
        enforceWhiteboardSizeLimit(doc);
      }
      schedulePersist(roomKey, doc, "yjsState");
    });

    roomDocs.set(roomKey, entry);
    logger.info({ roomKey }, "⚡ Initialized Yjs CRDT coding document");

    return entry;
  } finally {
    release();
    roomCreationLocks.delete(roomKey);
  }
}

/**
 * Get or initialize Yjs document for the whiteboard of an interview session.
 */
async function getOrCreateWhiteboardDoc(roomKey) {
  if (whiteboardDocs.has(roomKey)) return whiteboardDocs.get(roomKey);
  if (whiteboardCreationLocks.has(roomKey)) {
    await whiteboardCreationLocks.get(roomKey);
    if (whiteboardDocs.has(roomKey)) return whiteboardDocs.get(roomKey);
  }
  let release;
  const lock = new Promise((resolve) => (release = resolve));
  whiteboardCreationLocks.set(roomKey, lock);
  try {
    if (whiteboardDocs.has(roomKey)) return whiteboardDocs.get(roomKey);
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);

    // Load persisted whiteboard state
    await loadPersistedState(doc, roomKey, "yjsWhiteboardState");

    const entry = {
      doc,
      awareness,
      clients: new Set(),
      persistTimer: null,
      lastPersisted: Date.now(),
      gcTimer: null,
    };

    doc.on("update", (update, origin) => {
      if (origin !== "size-limit-enforcement" && origin !== "whiteboard-size-limit" && origin !== "sanitize-filesystem") {
        enforceYTextSizeLimit(doc);
        enforceWhiteboardSizeLimit(doc);
        sanitizeFilesystemPaths(doc);
      }
      schedulePersist(roomKey, doc, "yjsWhiteboardState");
    });

    whiteboardDocs.set(roomKey, entry);
    logger.info({ roomKey }, "🎨 Initialized Yjs CRDT whiteboard document");

    return entry;
  } finally {
    release();
    whiteboardCreationLocks.delete(roomKey);
  }
}

/**
 * Create initial Yjs sync step 1 message for a connecting WebSocket client.
 */
function createSyncStep1Message(doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return Buffer.from(encoding.toUint8Array(encoder));
}

/**
 * Handle incoming raw binary Yjs message from a WebSocket client.
 * Processes both sync and awareness messages.
 * Returns a response buffer if one must be sent back, or null.
 */
function handleYjsMessage(doc, awareness, messageBuffer, origin) {
  try {
    const uint8 = new Uint8Array(messageBuffer);
    const decoder = decoding.createDecoder(uint8);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MESSAGE_SYNC) {
      // Pre-check: if any Y.Text already near limit, we will truncate after
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, origin);
      // Enforce 100KB size limit after applying update (Yjs insert bypass defense)
      enforceYTextSizeLimit(doc);
      sanitizeFilesystemPaths(doc);
      enforceWhiteboardSizeLimit(doc);
      if (encoding.length(encoder) > 1) {
        return Buffer.from(encoding.toUint8Array(encoder));
      }
      return null;
    }

    if (messageType === MESSAGE_AWARENESS) {
      const rawUpdate = decoding.readVarUint8Array(decoder);
      // Validate awareness user field against socket.user (only allow name from auth) and sanitize
      const sanitized = sanitizeAwarenessUpdate(rawUpdate, origin);
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        sanitized,
        origin
      );
      return null;
    }
  } catch (err) {
    logger.error({ err: err.message }, "Error handling Yjs binary message");
  }
  return null;
}

/**
 * Build an awareness broadcast message for all remote clients.
 */
function buildAwarenessUpdate(awareness, changedClients) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
  );
  return Buffer.from(encoding.toUint8Array(encoder));
}

/**
 * Build a Yjs document update broadcast message.
 */
function buildDocUpdateMessage(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return Buffer.from(encoding.toUint8Array(encoder));
}

/**
 * Schedule GC of room if it stays empty for ROOM_GC_DELAY_MS.
 */
function scheduleRoomGC(roomKey, map) {
  const entry = map.get(roomKey);
  if (!entry) return;
  if (entry.gcTimer) clearTimeout(entry.gcTimer);
  entry.gcTimer = setTimeout(() => {
    const e = map.get(roomKey);
    if (e && e.clients.size === 0) {
      if (e.persistTimer) clearTimeout(e.persistTimer);
      e.awareness.destroy();
      e.doc.destroy();
      map.delete(roomKey);
      logger.info({ roomKey }, "GC: Cleaned up inactive Yjs room document");
    }
  }, ROOM_GC_DELAY_MS);
}

// ─── Legacy helpers kept for existing tests ────────────────────────────────

/**
 * Set file content directly in Yjs doc (used by existing tests)
 */
function setFileContentInDoc(roomKey, filename, content) {
  const entry = roomDocs.get(roomKey);
  if (!entry) return;
  let safeContent = String(content || "");
  if (Buffer.byteLength(safeContent, "utf8") > MAX_YTEXT_SIZE) {
    logger.warn({ roomKey, filename, size: safeContent.length }, "Y.Text insert exceeds 100KB, truncating");
    safeContent = safeContent.slice(0, MAX_YTEXT_SIZE);
  }
  // Also enforce current Y.Text size limit
  const yText = entry.doc.getText(filename);
  if (yText.length + safeContent.length > MAX_YTEXT_SIZE) {
    safeContent = safeContent.slice(0, Math.max(0, MAX_YTEXT_SIZE - yText.length));
    if (!safeContent) {
      logger.warn({ roomKey, filename }, "Y.Text insert would exceed 100000, rejecting");
      return yText.toString();
    }
  }
  entry.doc.transact(() => {
    yText.delete(0, yText.length);
    yText.insert(0, safeContent);
  });
  // Enforce again after transact
  enforceYTextSizeLimit(entry.doc);
  return yText.toString();
}

function getFileContentFromDoc(roomKey, filename) {
  const entry = roomDocs.get(roomKey);
  if (!entry) return "";
  return entry.doc.getText(filename).toString();
}

function cleanupRoomDoc(roomKey) {
  const entry = roomDocs.get(roomKey);
  if (entry) {
    if (entry.persistTimer) clearTimeout(entry.persistTimer);
    if (entry.gcTimer) clearTimeout(entry.gcTimer);
    entry.awareness.destroy();
    entry.doc.destroy();
    roomDocs.delete(roomKey);
    logger.info({ roomKey }, "Cleaned up Yjs CRDT room document");
  }
}

// Keep backward-compat alias used in existing tests
function getOrCreateRoomDocSync(roomKey) {
  if (roomDocs.has(roomKey)) return roomDocs.get(roomKey);
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const entry = {
    doc,
    awareness,
    clients: new Set(),
    persistTimer: null,
    lastPersisted: Date.now(),
    gcTimer: null,
  };
  doc.on("update", (update, origin) => {
    if (origin !== "size-limit-enforcement" && origin !== "sanitize-filesystem" && origin !== "whiteboard-size-limit") {
      enforceYTextSizeLimit(doc);
      sanitizeFilesystemPaths(doc);
      enforceWhiteboardSizeLimit(doc);
    }
    schedulePersist(roomKey, doc, "yjsState");
  });
  roomDocs.set(roomKey, entry);
  return entry;
}

module.exports = {
  getOrCreateRoomDoc,
  getOrCreateWhiteboardDoc,
  getOrCreateRoomDocSync,
  createSyncStep1Message,
  handleYjsMessage,
  buildAwarenessUpdate,
  buildDocUpdateMessage,
  scheduleRoomGC,
  setFileContentInDoc,
  getFileContentFromDoc,
  cleanupRoomDoc,
  persistRoomDocNow,
  roomDocs,
  whiteboardDocs,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  // Legacy aliases for existing tests
  handleYjsUpdate: (roomKey, socket, buf) => {
    const entry = getOrCreateRoomDocSync(roomKey);
    const resp = handleYjsMessage(entry.doc, entry.awareness, buf, socket);
    if (resp) socket.emit("yjs_sync", resp);
  },
  createSyncStep1: (doc) => createSyncStep1Message(doc),
};
