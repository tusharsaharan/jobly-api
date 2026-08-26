const Y = require("yjs");
const logger = require("../config/logger");
const CodeCheckpoint = require("../models/CodeCheckpoint");
const TimelineEvent = require("../models/TimelineEvent");
const { getOrCreateRoomDoc, persistRoomDocNow } = require("../infrastructure/realtime/yjsCoordinator");

const { sessionOffsetMs } = require("./interviewClock");

/**
 * Capture an immutable workspace snapshot into a CodeCheckpoint
 */
async function createCheckpoint(session, triggerType, triggerLabel) {
  try {
    const entry = await getOrCreateRoomDoc(session.roomKey);
    const { doc } = entry;
    const filesystem = doc.getMap("filesystem");

    // Gather all active file snapshots from Y.Doc
    const filesSnapshot = [];
    filesystem.forEach((item, pathKey) => {
      if (item.type === "file") {
        const content = doc.getText(pathKey).toString();
        filesSnapshot.push({
          path: pathKey,
          name: item.name || pathKey.split("/").pop(),
          content,
          language: item.language || "python",
        });
      }
    });

    // Resolve active language & path from meta map or session
    const metaMap = doc.getMap("meta");
    const activeLang = metaMap.get("activeLanguage") || session.codeWorkspace?.activeLanguage || "python";
    const ext = activeLang === "cpp" ? "cpp" : activeLang === "javascript" ? "js" : activeLang === "typescript" ? "ts" : activeLang === "java" ? "java" : "py";
    const expectedSrcPath = `/src/solution.${ext}`;
    const expectedRootPath = `/solution.${ext}`;

    // Sort filesSnapshot so primary code solution file is at index 0
    filesSnapshot.sort((a, b) => {
      if (a.path === expectedSrcPath || a.path === expectedRootPath) return -1;
      if (b.path === expectedSrcPath || b.path === expectedRootPath) return 1;
      if (a.path.includes("solution")) return -1;
      if (b.path.includes("solution")) return 1;
      return 0;
    });

    const existingActiveFile = filesSnapshot.find(
      (f) => f.path === expectedSrcPath || f.path === expectedRootPath || f.path.includes("solution")
    );

    if (!existingActiveFile) {
      const srcText = doc.getText(expectedSrcPath).toString();
      const rootText = doc.getText(expectedRootPath).toString();
      const content = srcText || rootText || "";
      if (content) {
        filesSnapshot.unshift({
          path: srcText ? expectedSrcPath : expectedRootPath,
          name: `solution.${ext}`,
          content,
          language: activeLang,
        });
      }
    }

    // Fallback if filesSnapshot is still empty
    if (filesSnapshot.length === 0) {
      const defaultText = doc.getText("/src/solution.py").toString() || doc.getText("/solution.py").toString();
      filesSnapshot.push({
        path: "/src/solution.py",
        name: "solution.py",
        content: defaultText,
        language: "python",
      });
    }

    // Determine monotonic sequence number
    const lastCheckpoint = await CodeCheckpoint.findOne({ session: session._id })
      .sort({ sequenceNumber: -1 })
      .select("sequenceNumber")
      .lean();

    const sequenceNumber = (lastCheckpoint?.sequenceNumber || 0) + 1;
    const yjsStateVector = Buffer.from(Y.encodeStateVector(doc));
    const offsetMs = sessionOffsetMs(session);

    const checkpoint = await CodeCheckpoint.create({
      session: session._id,
      triggerType,
      triggerLabel: triggerLabel || `Snapshot #${sequenceNumber}`,
      filesSnapshot,
      yjsStateVector,
      offsetMs,
      sequenceNumber,
    });

    // Record into Unified Timeline
    const timelineEvent = await TimelineEvent.create({
      session: session._id,
      pipeline: "CODING",
      eventType: "code.checkpoint",
      offsetMs,
      payload: {
        checkpointId: checkpoint._id.toString(),
        text: `Checkpoint #${sequenceNumber}: ${checkpoint.triggerLabel}`,
        sequenceNumber,
        triggerType,
        filesCount: filesSnapshot.length,
      },
    });

    // Broadcast timeline event and checkpoint created to all room participants
    const { getIO } = require("../infrastructure/realtime/socketio");
    const io = getIO();
    if (io && session.roomKey) {
      io.to(`interview:${session.roomKey}`).emit("timeline_event_received", timelineEvent);
      io.to(`interview:${session.roomKey}`).emit("checkpoint_created", checkpoint);
    }

    logger.info(
      { sessionId: session._id, sequenceNumber, triggerType },
      "Code checkpoint created"
    );

    return checkpoint;
  } catch (err) {
    logger.error({ err: err.message, sessionId: session._id }, "Error creating code checkpoint");
    throw err;
  }
}

/**
 * Restore live collaborative Yjs workspace to a historical checkpoint
 */
async function restoreCheckpoint(session, checkpointId) {
  try {
    const checkpoint = await CodeCheckpoint.findOne({
      _id: checkpointId,
      session: session._id,
    });

    if (!checkpoint) {
      const error = new Error("Code checkpoint not found for this session");
      error.status = 404;
      throw error;
    }

    const entry = await getOrCreateRoomDoc(session.roomKey);
    const { doc } = entry;
    const filesystem = doc.getMap("filesystem");

    // Atomically reset Yjs CRDT workspace in single transaction
    doc.transact(() => {
      // Clear current files
      filesystem.forEach((item, pathKey) => {
        if (item.type === "file") {
          const ytext = doc.getText(pathKey);
          ytext.delete(0, ytext.length);
        }
      });
      filesystem.clear();

      let targetLanguage = "python";
      // Repopulate from snapshot
      checkpoint.filesSnapshot.forEach((f) => {
        filesystem.set(f.path, {
          type: "file",
          name: f.name,
          path: f.path,
          language: f.language,
        });
        const ytext = doc.getText(f.path);
        ytext.delete(0, ytext.length);
        ytext.insert(0, f.content || "");
        if (f.language) targetLanguage = f.language;
      });

      // Update meta map so all connected participants switch to restored language
      doc.getMap("meta").set("activeLanguage", targetLanguage);
    });

    await persistRoomDocNow(session.roomKey, doc, "yjsState");

    const offsetMs = session.actualStart
      ? Math.max(0, Date.now() - new Date(session.actualStart).getTime())
      : 0;

    const timelineEvent = await TimelineEvent.create({
      session: session._id,
      pipeline: "CODING",
      eventType: "checkpoint.restored",
      offsetMs,
      payload: {
        checkpointId: checkpoint._id.toString(),
        text: `Restored workspace to Checkpoint #${checkpoint.sequenceNumber}`,
        sequenceNumber: checkpoint.sequenceNumber,
      },
    });

    // Broadcast timeline event and checkpoint restored to all room participants
    const { getIO } = require("../infrastructure/realtime/socketio");
    const io = getIO();
    if (io && session.roomKey) {
      io.to(`interview:${session.roomKey}`).emit("timeline_event_received", timelineEvent);
      io.to(`interview:${session.roomKey}`).emit("checkpoint_restored", checkpoint);
    }

    logger.info(
      { sessionId: session._id, checkpointId, sequenceNumber: checkpoint.sequenceNumber },
      "Workspace restored from checkpoint"
    );

    return checkpoint;
  } catch (err) {
    logger.error({ err: err.message, sessionId: session._id }, "Error restoring code checkpoint");
    throw err;
  }
}

module.exports = {
  createCheckpoint,
  restoreCheckpoint,
};
