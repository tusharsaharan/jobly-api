const logger = require("../config/logger");
const InterviewSession = require("../models/InterviewSession");
const TimelineEvent = require("../models/TimelineEvent");
const CodeCheckpoint = require("../models/CodeCheckpoint");
const WhiteboardSnapshot = require("../models/WhiteboardSnapshot");

/**
 * Authorize participant
 */
async function authorizeParticipant(sessionIdOrRoomKey, user) {
  const session = await InterviewSession.findOne({
    $or: [
      { _id: sessionIdOrRoomKey.match(/^[0-9a-fA-F]{24}$/) ? sessionIdOrRoomKey : null },
      { roomKey: sessionIdOrRoomKey },
    ],
  })
    .populate("seeker", "name email")
    .populate("recruiter", "name email")
    .populate("job", "title company");

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
    const error = new Error("Access denied. You are not an authorized viewer of this interview session.");
    error.status = 403;
    throw error;
  }

  return session;
}

/**
 * GET /api/replay/:sessionId/manifest
 * Retrieve complete playback manifest with full chronological timeline & total duration
 */
exports.getReplayManifest = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await authorizeParticipant(sessionId, req.user);

    const timelineEvents = await TimelineEvent.find({ session: session._id })
      .populate("participant", "name role")
      .sort({ offsetMs: 1 })
      .lean();

    const totalDurationMs =
      session.actualEnd && session.actualStart
        ? Math.max(0, new Date(session.actualEnd).getTime() - new Date(session.actualStart).getTime())
        : timelineEvents.length > 0
        ? timelineEvents[timelineEvents.length - 1].offsetMs
        : 0;

    const stages = timelineEvents
      .filter((ev) => ev.pipeline === "STAGE")
      .map((ev) => ({
        stage: ev.payload?.stage,
        offsetMs: ev.offsetMs,
      }));

    return res.json({
      session: {
        _id: session._id,
        roomKey: session.roomKey,
        title: session.title,
        job: session.job,
        seeker: session.seeker,
        recruiter: session.recruiter,
        actualStart: session.actualStart,
        actualEnd: session.actualEnd,
      },
      totalDurationMs,
      eventCount: timelineEvents.length,
      stages,
      timelineEvents,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error fetching replay manifest");
    return res.status(err.status || 500).json({ msg: err.message || "Failed fetching replay manifest" });
  }
};

/**
 * GET /api/replay/:sessionId/frame?offsetMs=120000
 * Reconstruct complete unified interview state at an exact point in time
 */
exports.getReplayFrame = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { offsetMs = 0 } = req.query;
    const targetOffset = Number(offsetMs);

    const session = await authorizeParticipant(sessionId, req.user);

    // 1. Find most recent code checkpoint up to targetOffset
    const codeCheckpoint = await CodeCheckpoint.findOne({
      session: session._id,
    })
      .sort({ sequenceNumber: -1 })
      .select("-yjsStateVector")
      .lean();

    // 2. Find most recent whiteboard snapshot up to targetOffset
    const whiteboardSnapshot = await WhiteboardSnapshot.findOne({
      session: session._id,
    })
      .sort({ sequenceNumber: -1 })
      .lean();

    // 3. Find active stage at targetOffset
    const lastStageEvent = await TimelineEvent.findOne({
      session: session._id,
      pipeline: "STAGE",
      offsetMs: { $lte: targetOffset },
    })
      .sort({ offsetMs: -1 })
      .lean();

    // 4. Find all transcript segments up to targetOffset
    const transcriptHistory = await TimelineEvent.find({
      session: session._id,
      pipeline: "COMMUNICATION",
      offsetMs: { $lte: targetOffset },
    })
      .populate("participant", "name role")
      .sort({ offsetMs: 1 })
      .lean();

    return res.json({
      offsetMs: targetOffset,
      activeStage: lastStageEvent?.payload?.stage || "WAITING_ROOM",
      codeWorkspace: {
        checkpointId: codeCheckpoint?._id || null,
        sequenceNumber: codeCheckpoint?.sequenceNumber || 0,
        files: codeCheckpoint?.filesSnapshot || [],
      },
      whiteboard: {
        snapshotId: whiteboardSnapshot?._id || null,
        sequenceNumber: whiteboardSnapshot?.sequenceNumber || 0,
        objects: whiteboardSnapshot?.objects || [],
      },
      transcriptHistory: transcriptHistory.map((t) => ({
        speakerName: t.participant?.name || "Participant",
        role: t.participantRole,
        text: t.payload?.text || "",
        offsetMs: t.offsetMs,
      })),
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error reconstructing replay frame");
    return res.status(err.status || 500).json({ msg: err.message || "Failed reconstructing replay frame" });
  }
};
