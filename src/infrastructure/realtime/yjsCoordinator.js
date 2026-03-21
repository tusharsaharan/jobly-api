const Y = require("yjs");
const syncProtocol = require("y-protocols/dist/sync.cjs");
const awarenessProtocol = require("y-protocols/dist/awareness.cjs");
const encoding = require("lib0/dist/encoding.cjs");
const decoding = require("lib0/dist/decoding.cjs");
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

/**
 * Load persisted Yjs state from MongoDB and apply to doc
 */
async function loadPersistedState(doc, sessionIdentifier, field) {
  try {
    const session = await InterviewSession.findOne({
      $or: [{ roomKey: sessionIdentifier }, { _id: sessionIdentifier }],
    }).select(field).lean();

    if (session && session[field]) {
      Y.applyUpdate(doc, new Uint8Array(session[field]));
      logger.debug({ sessionIdentifier, field }, "Loaded persisted Yjs state from MongoDB");
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

/**
 * Get or initialize Yjs document for the coding workspace of an interview session.
 * On first creation, loads persisted state from MongoDB.
 */
async function getOrCreateRoomDoc(roomKey) {
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
  doc.on("update", () => {
    schedulePersist(roomKey, doc, "yjsState");
  });

  roomDocs.set(roomKey, entry);
  logger.info({ roomKey }, "⚡ Initialized Yjs CRDT coding document");

  return entry;
}

/**
 * Get or initialize Yjs document for the whiteboard of an interview session.
 */
async function getOrCreateWhiteboardDoc(roomKey) {
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

  doc.on("update", () => {
    schedulePersist(roomKey, doc, "yjsWhiteboardState");
  });

  whiteboardDocs.set(roomKey, entry);
  logger.info({ roomKey }, "🎨 Initialized Yjs CRDT whiteboard document");

  return entry;
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
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, origin);
      if (encoding.length(encoder) > 1) {
        return Buffer.from(encoding.toUint8Array(encoder));
      }
      return null;
    }

    if (messageType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        decoding.readVarUint8Array(decoder),
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
  const yText = entry.doc.getText(filename);
  entry.doc.transact(() => {
    yText.delete(0, yText.length);
    yText.insert(0, content);
  });
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
  doc.on("update", () => schedulePersist(roomKey, doc, "yjsState"));
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
