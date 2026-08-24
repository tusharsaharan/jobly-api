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
    .populate("seeker", "name email role")
    .populate("recruiter", "name email role")
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
        ? Math.max(60000, timelineEvents[timelineEvents.length - 1].offsetMs + 10000)
        : 60000;

    const stages = timelineEvents
      .filter((ev) => ev.pipeline === "STAGE")
      .map((ev) => ({
        stage: ev.payload?.stage,
        status: ev.payload?.status,
        offsetMs: ev.offsetMs,
      }));

    // If no stage events exist, create default stage milestones
    if (stages.length === 0) {
      stages.push(
        { stage: "INTRODUCTION", offsetMs: 0 },
        { stage: "CODING", offsetMs: Math.floor(totalDurationMs * 0.2) },
        { stage: "SYSTEM_DESIGN", offsetMs: Math.floor(totalDurationMs * 0.6) },
        { stage: "FEEDBACK", offsetMs: Math.floor(totalDurationMs * 0.85) }
      );
    }

    // Milestones for interactive scrubber indicators
    const milestones = timelineEvents.map((ev) => ({
      id: ev._id,
      offsetMs: ev.offsetMs,
      pipeline: ev.pipeline,
      eventType: ev.eventType,
      speaker: ev.participant?.name || (ev.participantRole === "recruiter" ? "Interviewer" : "Candidate"),
      role: ev.participantRole,
      summary:
        ev.pipeline === "STAGE"
          ? `Stage: ${ev.payload?.stage || "Transition"}`
          : ev.pipeline === "CODING"
          ? `Code Run (Exit ${ev.payload?.exitCode ?? 0})`
          : ev.pipeline === "COMMUNICATION"
          ? (ev.payload?.text ? `${ev.payload.text.slice(0, 45)}...` : "Speech Turn")
          : `${ev.eventType}`,
    }));

    return res.json({
      session: {
        _id: session._id,
        roomKey: session.roomKey,
        title: session.title,
        job: session.job,
        seeker: session.seeker,
        recruiter: session.recruiter,
        status: session.status,
        stage: session.stage,
        recordingUrl: session.recordingUrl || null,
        actualStart: session.actualStart,
        actualEnd: session.actualEnd,
      },
      totalDurationMs,
      eventCount: timelineEvents.length,
      stages,
      milestones,
      speakers: {
        seeker: {
          name: session.seeker?.name || "Candidate",
          role: "Candidate",
          email: session.seeker?.email,
        },
        recruiter: {
          name: session.recruiter?.name || "Lead Interviewer",
          role: "Interviewer",
          email: session.recruiter?.email,
        },
      },
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
      offsetMs: { $lte: targetOffset },
    })
      .sort({ offsetMs: -1, sequenceNumber: -1 })
      .select("-yjsStateVector")
      .lean();

    // 2. Find most recent whiteboard snapshot up to targetOffset
    const whiteboardSnapshot = await WhiteboardSnapshot.findOne({
      session: session._id,
      offsetMs: { $lte: targetOffset },
    })
      .sort({ offsetMs: -1, sequenceNumber: -1 })
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

    // Active speaking event right now (within 4000ms window)
    const activeSpeechEvent = await TimelineEvent.findOne({
      session: session._id,
      pipeline: "COMMUNICATION",
      offsetMs: { $gte: Math.max(0, targetOffset - 3500), $lte: targetOffset + 1000 },
    })
      .populate("participant", "name role")
      .sort({ offsetMs: -1 })
      .lean();

    // Fallback code files
    let codeFiles = (codeCheckpoint?.filesSnapshot && codeCheckpoint.filesSnapshot.length > 0)
      ? codeCheckpoint.filesSnapshot
      : (session.codeWorkspace?.files || []);

    if ((!codeFiles || codeFiles.length === 0) && session.codeWorkspace?.files?.length) {
      codeFiles = session.codeWorkspace.files;
    }

    if (!codeFiles || codeFiles.length === 0) {
      codeFiles = [
        {
          name: "solution.py",
          path: "/solution.py",
          language: "python",
          content: "# Solution Workspace\n\ndef solve():\n    # Candidate solution\n    return True\n",
        },
      ];
    }

    const codeSource = codeCheckpoint ? "checkpoint" : (session.codeWorkspace?.files?.length ? "initial" : "default");
    const boardSource = whiteboardSnapshot ? "snapshot" : "none";

    const isSeekerSpeaking = activeSpeechEvent?.participantRole === "seeker" || (!activeSpeechEvent && (targetOffset / 3000) % 2 < 1);
    const activeSpeakerRole = activeSpeechEvent?.participantRole || (isSeekerSpeaking ? "seeker" : "recruiter");
    const activeSpeakerName =
      activeSpeechEvent?.participant?.name ||
      (activeSpeakerRole === "seeker" ? session.seeker?.name || "Candidate" : session.recruiter?.name || "Interviewer");

    return res.json({
      offsetMs: targetOffset,
      activeStage: lastStageEvent?.payload?.stage || (targetOffset > 10000 ? (session.stage || "CODING") : "INTRODUCTION"),
      codeWorkspace: {
        checkpointId: codeCheckpoint?._id || null,
        sequenceNumber: codeCheckpoint?.sequenceNumber || 0,
        atOffsetMs: codeCheckpoint?.offsetMs ?? (codeSource === "initial" ? 0 : null),
        files: codeFiles,
      },
      whiteboard: {
        snapshotId: whiteboardSnapshot?._id || null,
        sequenceNumber: whiteboardSnapshot?.sequenceNumber || 0,
        atOffsetMs: whiteboardSnapshot?.offsetMs ?? null,
        objects: whiteboardSnapshot?.objects || [],
      },
      frameAvailability: {
        code: {
          source: codeSource,
          atOffsetMs: codeCheckpoint?.offsetMs ?? (codeSource === "initial" ? 0 : null),
          isApproximate: codeCheckpoint ? codeCheckpoint.offsetMs < targetOffset : false,
        },
        board: {
          source: boardSource,
          atOffsetMs: whiteboardSnapshot?.offsetMs ?? null,
          isApproximate: whiteboardSnapshot ? whiteboardSnapshot.offsetMs < targetOffset : false,
        },
      },
      videoState: {
        candidate: {
          name: session.seeker?.name || "Candidate",
          role: "Candidate",
          cameraActive: true,
          micActive: true,
          isSpeaking: activeSpeakerRole === "seeker",
          audioActivityLevel: activeSpeakerRole === "seeker" ? Math.floor(65 + Math.sin(targetOffset / 200) * 30) : 0,
        },
        interviewer: {
          name: session.recruiter?.name || "Lead Interviewer",
          role: "Interviewer",
          cameraActive: true,
          micActive: true,
          isSpeaking: activeSpeakerRole === "recruiter",
          audioActivityLevel: activeSpeakerRole === "recruiter" ? Math.floor(60 + Math.cos(targetOffset / 200) * 30) : 0,
        },
      },
      activeSpeaker: {
        name: activeSpeakerName,
        role: activeSpeakerRole,
        text: activeSpeechEvent?.payload?.text || null,
      },
      transcriptHistory: transcriptHistory.map((t) => ({
        speakerName: t.participant?.name || (t.participantRole === "recruiter" ? "Interviewer" : "Candidate"),
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
