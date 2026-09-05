const logger = require("../config/logger");
const InterviewSession = require("../models/InterviewSession");
const WhiteboardSnapshot = require("../models/WhiteboardSnapshot");
const TimelineEvent = require("../models/TimelineEvent");
const { getOrCreateWhiteboardDoc, persistRoomDocNow } = require("../infrastructure/realtime/yjsCoordinator");
const { sessionOffsetMs } = require("../services/interviewClock");

/**
 * Authorize participant
 */
async function authorizeParticipant(sessionIdOrRoomKey, user) {
  const tenantFilter = user?.tenantId ? { tenantId: user.tenantId } : {};
  const session = await InterviewSession.findOne({
    $and: [
      { $or: [{ _id: sessionIdOrRoomKey.match(/^[0-9a-fA-F]{24}$/) ? sessionIdOrRoomKey : null }, { roomKey: sessionIdOrRoomKey }] },
      tenantFilter,
    ],
  }).populate("seeker recruiter additionalInterviewers");

  if (!session) {
    const error = new Error("Interview session not found");
    error.status = 404;
    throw error;
  }

  const uid = String(user._id || user.id);
  const isSeeker = String(session.seeker?._id || session.seeker) === uid;
  const isRecruiter = String(session.recruiter?._id || session.recruiter) === uid;
  const isAdditional = (session.additionalInterviewers || []).some(
    (id) => String(id?._id || id) === uid
  );

  if (!isSeeker && !isRecruiter && !isAdditional) {
    const error = new Error("Access denied. You are not a registered participant.");
    error.status = 403;
    throw error;
  }

  return session;
}

const MAX_WHITEBOARD_ELEMENTS = 3000;
const MAX_WHITEBOARD_TOTAL_SIZE = 500 * 1024; // 500KB
const MAX_WHITEBOARD_ELEMENT_SIZE = 20 * 1024; // 20KB per element

/**
 * POST /api/whiteboard/:sessionId/snapshots
 * Save an immutable snapshot of current whiteboard canvas
 */
exports.createSnapshot = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { previewImageUrl, canvasWidth = 1920, canvasHeight = 1080 } = req.body;
    const session = await authorizeParticipant(sessionId, req.user);

    const entry = await getOrCreateWhiteboardDoc(session.roomKey);
    const { doc } = entry;
    const legacyObjectsMap = doc.getMap("objects");
    const excalidrawElementsMap = doc.getMap("excalidraw-elements");
    const boardType = excalidrawElementsMap.size > 0 ? "EXCALIDRAW" : "LEGACY";
    const sourceMap = boardType === "EXCALIDRAW" ? excalidrawElementsMap : legacyObjectsMap;
    const objects = [];
    sourceMap.forEach((value) => {
      if (boardType === "EXCALIDRAW" && typeof value === "string") {
        try {
          objects.push(JSON.parse(value));
        } catch {
          // Ignore malformed collaborative entries; the rest of the snapshot is usable.
        }
      } else {
        objects.push(value);
      }
    });

    // Whiteboard size limits: element count and size (prevent 16MB breach and S3 fallback)
    if (objects.length > MAX_WHITEBOARD_ELEMENTS) {
      return res.status(413).json({ msg: `Whiteboard element limit exceeded: ${objects.length} > ${MAX_WHITEBOARD_ELEMENTS}` });
    }
    let totalSize = 0;
    for (const obj of objects) {
      const elStr = JSON.stringify(obj);
      if (elStr.length > MAX_WHITEBOARD_ELEMENT_SIZE) {
        return res.status(413).json({ msg: `Whiteboard element too large: ${elStr.length} bytes > ${MAX_WHITEBOARD_ELEMENT_SIZE} (id: ${obj.id || "unknown"})` });
      }
      totalSize += elStr.length;
    }
    if (totalSize > MAX_WHITEBOARD_TOTAL_SIZE) {
      return res.status(413).json({ msg: `Whiteboard total size exceeds ${MAX_WHITEBOARD_TOTAL_SIZE} bytes (${totalSize} bytes)` });
    }

    // Atomic monotonic sequence to prevent duplicate numbers under concurrent two-user snapshots (fixes brutal race)
    const updatedSession = await InterviewSession.findOneAndUpdate(
      { _id: session._id },
      { $inc: { whiteboardSequence: 1 } },
      { new: true }
    );
    const sequenceNumber = updatedSession.whiteboardSequence;

    const offsetMs = sessionOffsetMs(session);

    const snapshot = await WhiteboardSnapshot.create({
      session: session._id,
      objects,
      boardType,
      canvasWidth,
      canvasHeight,
      offsetMs,
      sequenceNumber,
      previewImageUrl: previewImageUrl || null,
    });

    const timelineEv = await TimelineEvent.create({
      session: session._id,
      pipeline: "WHITEBOARD",
      eventType: "whiteboard.snapshot",
      offsetMs,
      participant: req.user._id,
      participantRole: req.user.role || "seeker",
      payload: {
        whiteboardSnapshotId: snapshot._id.toString(),
        text: `Whiteboard Snapshot #${sequenceNumber} (${objects.length} elements)`,
      },
    });

    await persistRoomDocNow(session.roomKey, doc, "yjsWhiteboardState");

    try {
      const { getIO } = require("../infrastructure/realtime/socketio");
      const io = getIO();
      if (io && session.roomKey) {
        io.to(`interview:${session.roomKey}`).emit("timeline_event_received", timelineEv);
        io.to(`interview:${session.roomKey}`).emit("whiteboard_snapshot_saved", {
          snapshot,
          timelineEvent: timelineEv,
        });
      }
    } catch {}

    return res.status(201).json({
      msg: "Whiteboard snapshot created successfully",
      snapshot,
      timelineEvent: timelineEv,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error creating whiteboard snapshot");
    return res.status(err.status || 500).json({ msg: err.message || "Failed creating snapshot" });
  }
};

/**
 * GET /api/whiteboard/:sessionId/snapshots
 * List all historical whiteboard snapshots
 */
exports.listSnapshots = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await authorizeParticipant(sessionId, req.user);

    const snapshots = await WhiteboardSnapshot.find({ session: session._id })
      .sort({ sequenceNumber: -1 })
      .lean();

    return res.json({ snapshots });
  } catch (err) {
    logger.error({ err: err.message }, "Error listing whiteboard snapshots");
    return res.status(err.status || 500).json({ msg: err.message || "Failed listing snapshots" });
  }
};

/**
 * POST /api/whiteboard/:sessionId/snapshots/:snapshotId/restore
 * Restore whiteboard canvas to historical snapshot
 */
exports.restoreSnapshot = async (req, res) => {
  try {
    const { sessionId, snapshotId } = req.params;
    const session = await authorizeParticipant(sessionId, req.user);

    const snapshot = await WhiteboardSnapshot.findOne({
      _id: snapshotId,
      session: session._id,
    });

    if (!snapshot) {
      return res.status(404).json({ msg: "Whiteboard snapshot not found" });
    }

    const entry = await getOrCreateWhiteboardDoc(session.roomKey);
    const { doc } = entry;
    const legacyObjectsMap = doc.getMap("objects");
    const excalidrawElementsMap = doc.getMap("excalidraw-elements");
    const isExcalidraw = snapshot.boardType === "EXCALIDRAW";
    const targetMap = isExcalidraw ? excalidrawElementsMap : legacyObjectsMap;

    doc.transact(() => {
      targetMap.clear();
      snapshot.objects.forEach((obj, idx) => {
        const id = obj.id || `obj_${idx}_${Date.now()}`;
        targetMap.set(id, isExcalidraw ? JSON.stringify(obj) : obj);
      });
    });

    await persistRoomDocNow(session.roomKey, doc, "yjsWhiteboardState");

    const offsetMs = session.actualStart
      ? Math.max(0, Date.now() - new Date(session.actualStart).getTime())
      : 0;

    await TimelineEvent.create({
      session: session._id,
      pipeline: "WHITEBOARD",
      eventType: "whiteboard.restored",
      offsetMs,
      participant: req.user._id,
      participantRole: req.user.role || "seeker",
      payload: {
        whiteboardSnapshotId: snapshot._id.toString(),
        text: `Restored whiteboard to Snapshot #${snapshot.sequenceNumber}`,
      },
    });

    return res.json({ msg: "Whiteboard restored successfully", snapshot });
  } catch (err) {
    logger.error({ err: err.message }, "Error restoring whiteboard snapshot");
    return res.status(err.status || 500).json({ msg: err.message || "Failed restoring snapshot" });
  }
};
