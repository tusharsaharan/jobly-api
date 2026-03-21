const Y = require("yjs");
const logger = require("../config/logger");
const CodeCheckpoint = require("../models/CodeCheckpoint");
const TimelineEvent = require("../models/TimelineEvent");
const { getOrCreateRoomDoc, persistRoomDocNow } = require("../infrastructure/realtime/yjsCoordinator");

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

    // Fallback if filesystem map was empty
    if (filesSnapshot.length === 0) {
      const defaultText = doc.getText("/solution.py").toString();
      filesSnapshot.push({
        path: "/solution.py",
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

    const checkpoint = await CodeCheckpoint.create({
      session: session._id,
      triggerType,
      triggerLabel: triggerLabel || `Snapshot #${sequenceNumber}`,
      filesSnapshot,
      yjsStateVector,
      sequenceNumber,
    });

    const offsetMs = session.actualStart
      ? Math.max(0, Date.now() - new Date(session.actualStart).getTime())
      : 0;

    // Record into Unified Timeline
    await TimelineEvent.create({
      session: session._id,
      pipeline: "CODING",
      eventType: "code.checkpoint",
      offsetMs,
      payload: {
        checkpointId: checkpoint._id.toString(),
        text: `Checkpoint #${sequenceNumber}: ${checkpoint.triggerLabel}`,
      },
    });

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
      });
    });

    await persistRoomDocNow(session.roomKey, doc, "yjsState");

    const offsetMs = session.actualStart
      ? Math.max(0, Date.now() - new Date(session.actualStart).getTime())
      : 0;

    await TimelineEvent.create({
      session: session._id,
      pipeline: "CODING",
      eventType: "checkpoint.restored",
      offsetMs,
      payload: {
        checkpointId: checkpoint._id.toString(),
        text: `Restored workspace to Checkpoint #${checkpoint.sequenceNumber}`,
      },
    });

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
