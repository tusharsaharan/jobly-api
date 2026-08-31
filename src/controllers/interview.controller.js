const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config/env");
const logger = require("../config/logger");
const InterviewSession = require("../models/InterviewSession");
const InterviewProblem = require("../models/InterviewProblem");
const Application = require("../models/Application");
const TimelineEvent = require("../models/TimelineEvent");
const InterviewScorecard = require("../models/InterviewScorecard");
const InterviewInvite = require("../models/InterviewInvite");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Helper to generate secure, time-limited room token with participant role & permissions
 */
function generateRoomToken(session, user) {
  const isSeeker = session.seeker._id ? session.seeker._id.toString() === user._id.toString() : session.seeker.toString() === user._id.toString();
  const isRecruiter = session.recruiter._id ? session.recruiter._id.toString() === user._id.toString() : session.recruiter.toString() === user._id.toString();
  const isAdditional = (session.additionalInterviewers || []).some((id) =>
    (id._id ? id._id.toString() : id.toString()) === user._id.toString()
  );

  let role = "observer";
  let permissions = {
    canControlStage: false,
    canExecuteCode: false,
    canEditCode: false,
    canEditWhiteboard: true,
    canGradeScorecard: false,
    canViewAiAssistant: false,
  };

  if (isRecruiter || isAdditional) {
    role = "recruiter";
    permissions = {
      canControlStage: true,
      canExecuteCode: true,
      canEditCode: true,
      canEditWhiteboard: true,
      canGradeScorecard: true,
      canViewAiAssistant: true,
    };
  } else if (isSeeker) {
    role = "seeker";
    permissions = {
      canControlStage: false,
      canExecuteCode: true,
      canEditCode: true,
      canEditWhiteboard: true,
      canGradeScorecard: false,
      canViewAiAssistant: false,
    };
  }

  const payload = {
    sessionId: session._id.toString(),
    roomKey: session.roomKey,
    tenantId: session.tenantId,
    userId: user._id.toString(),
    userName: user.name,
    role,
    permissions,
  };

  const secret = config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678";
  if (!secret) throw new Error("JWT_SECRET not configured");
  if (process.env.NODE_ENV !== "test" && secret.length < 32) throw new Error("JWT_SECRET not configured");
  const token = jwt.sign(payload, secret, {
    expiresIn: "6h",
  });

  return { token, role, permissions };
}

/**
 * Schedule an Interview Session (Recruiter only)
 * POST /api/interviews/schedule
 */
exports.scheduleInterview = async (req, res) => {
  try {
    const { applicationId, scheduledStart, title, allowedLanguages, problemId } = req.body;

    if (!applicationId || !scheduledStart) {
      return res.status(400).json({ msg: "applicationId and scheduledStart are required." });
    }

    const appDoc = await Application.findById(applicationId)
      .populate("job")
      .populate("seeker", "-password")
      .populate("recruiter", "-password");

    if (!appDoc) {
      return res.status(404).json({ msg: "Application not found" });
    }

    // Verify recruiter authorization
    if (appDoc.recruiter._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ msg: "Only the hiring recruiter can schedule an interview." });
    }

    const roomKey = `room-${crypto.randomBytes(8).toString("hex")}`;

    const session = await InterviewSession.create({
      tenantId: req.user.tenantId || "default",
      application: appDoc._id,
      job: appDoc.job._id,
      seeker: appDoc.seeker._id,
      recruiter: req.user._id,
      title: title || `Technical Interview: ${appDoc.job.title}`,
      scheduledStart: new Date(scheduledStart),
      roomKey,
      allowedLanguages: allowedLanguages || ["python", "javascript", "typescript", "cpp", "java"],
      activeProblem: problemId || null,
      codeWorkspace: {
        files: [
          {
            name: "solution.py",
            path: "/solution.py",
            content: "# Write your solution below\n\ndef solution():\n    pass\n",
            language: "python",
          },
        ],
      },
    });

    // Record timeline creation event
    await TimelineEvent.create({
      session: session._id,
      pipeline: "STAGE",
      eventType: "session.created",
      offsetMs: 0,
      participant: req.user._id,
      participantRole: "recruiter",
      payload: {
        stage: session.stage,
        status: session.status,
      },
    });

    logger.info({ sessionId: session._id, roomKey }, "Interview session scheduled successfully");

    return res.status(201).json({
      msg: "Interview session scheduled successfully",
      session,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error scheduling interview");
    return res.status(500).json({ msg: "Failed to schedule interview session" });
  }
};

/**
 * Get Interview Session Details & Timeline
 * GET /api/interviews/:sessionId
 */
exports.getInterviewSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const tenantId = req.user.tenantId || "default";

    const session = await InterviewSession.findOne({ _id: sessionId, tenantId })
      .populate("job", "title company description skills")
      .populate("seeker", "name email skills degree cgpa college")
      .populate("recruiter", "name email")
      .populate("activeProblem");

    if (!session) {
      return res.status(404).json({ msg: "Interview session not found" });
    }

    // Object-level multi-tenant & participation authorization
    const isParticipant =
      session.seeker._id.toString() === req.user._id.toString() ||
      session.recruiter._id.toString() === req.user._id.toString() ||
      (session.additionalInterviewers || []).some(
        (id) => id.toString() === req.user._id.toString()
      );

    if (!isParticipant) {
      return res.status(403).json({ msg: "Access denied. You are not a registered participant." });
    }

    const { token: roomToken, role, permissions } = generateRoomToken(session, req.user);

    const timelineEvents = await TimelineEvent.find({ session: session._id })
      .sort({ offsetMs: 1, createdAt: 1 })
      .limit(200);

    return res.json({
      session,
      roomToken,
      role,
      permissions,
      timelineEvents,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error retrieving interview session");
    return res.status(500).json({ msg: "Failed retrieving interview session" });
  }
};

/**
 * Enter / Fetch Access Token by Room Key
 * GET /api/interviews/room/:roomKey
 */
exports.getInterviewByRoomKey = async (req, res) => {
  try {
    const { roomKey } = req.params;
    const tenantId = req.user.tenantId || "default";

    const session = await InterviewSession.findOne({ roomKey, tenantId })
      .populate("job", "title company description skills")
      .populate("seeker", "name email skills degree cgpa college")
      .populate("recruiter", "name email")
      .populate("activeProblem");

    if (!session) {
      return res.status(404).json({ msg: "Interview room not found" });
    }

    const isParticipant =
      session.seeker._id.toString() === req.user._id.toString() ||
      session.recruiter._id.toString() === req.user._id.toString() ||
      (session.additionalInterviewers || []).some(
        (id) => id.toString() === req.user._id.toString()
      );

    if (!isParticipant) {
      return res.status(403).json({ msg: "You are not authorized to join this interview room." });
    }

    const { token: roomToken, role, permissions } = generateRoomToken(session, req.user);

    const timelineEvents = await TimelineEvent.find({ session: session._id })
      .sort({ offsetMs: 1, createdAt: 1 })
      .lean();

    return res.json({
      session,
      roomToken,
      role,
      permissions,
      timelineEvents: timelineEvents || [],
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error joining interview room by key");
    return res.status(500).json({ msg: "Failed joining interview room" });
  }
};

/**
 * Execute Candidate Code in Sandbox for an Active Interview Session
 * POST /api/interviews/:sessionId/execute
 */
const { executeCodeSandbox } = require("../infrastructure/sandbox/sandboxService");

exports.executeCodeInSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { language, code, stdin } = req.body;

    if (!language || !code) {
      return res.status(400).json({ msg: "Language and code are required for execution." });
    }
    // Enforce 100KB code size limit (Yjs bypass defense)
    if (Buffer.byteLength(String(code), "utf8") > 100000) {
      return res.status(413).json({ msg: "Code exceeds 100KB limit" });
    }

    const ingressTimestamp = Date.now();
    const tenantId = req.user.tenantId || "default";

    const session = await InterviewSession.findOneAndUpdate(
      { _id: sessionId, tenantId },
      { $inc: { executionSequence: 1 } },
      { new: true }
    );
    if (!session) {
      return res.status(404).json({ msg: "Interview session not found." });
    }

    const uidExec = String(req.user._id);
    const isSeekerExec = String(session.seeker) === uidExec;
    const isRecruiterExec = String(session.recruiter) === uidExec;
    const isAdditionalExec = (session.additionalInterviewers || []).some((id) => String(id) === uidExec);
    if (!isSeekerExec && !isRecruiterExec && !isAdditionalExec) {
      return res.status(403).json({ msg: "Not authorized to execute code in this session." });
    }

    const canonicalSequence = session.executionSequence;

    const sandboxResult = await executeCodeSandbox({
      language,
      code,
      stdin: stdin || "",
      timeoutMs: 8000,
    });

    const execution = {
      ...sandboxResult,
      sequence: canonicalSequence,
      triggeredAt: ingressTimestamp,
      sessionId: session._id.toString(),
    };

    const calculatedOffset = session.actualStart
      ? Math.max(0, Date.now() - session.actualStart.getTime())
      : 0;

    // Atomically update lastExecution in database if and only if this execution is newer than or equal to current lastExecution
    await InterviewSession.updateOne(
      {
        _id: session._id,
        tenantId,
        $or: [
          { "lastExecution.sequence": { $exists: false } },
          { "lastExecution.sequence": { $lte: canonicalSequence } },
        ],
      },
      {
        $set: {
          lastExecution: execution,
        },
      }
    );

    // Record execution into the unified timeline
    const timelineEvent = await TimelineEvent.create({
      session: session._id,
      pipeline: "CODING",
      eventType: "code.execution",
      offsetMs: calculatedOffset,
      participant: req.user._id,
      participantRole: req.user.role || "seeker",
      payload: {
        text: `Executed ${language} (Exit ${execution.exitCode})`,
        executionId: execution.executionId,
        sequence: canonicalSequence,
        triggeredAt: ingressTimestamp,
        language,
        exitCode: execution.exitCode,
        durationMs: execution.durationMs,
        codeSnippet: escapeHtml(code.slice(0, 500)),
        status: execution.exitCode === 0 ? "success" : execution.timedOut ? "timeout" : "error",
      },
    });

    logger.info(
      { sessionId, sequence: canonicalSequence, language, exitCode: execution.exitCode, durationMs: execution.durationMs },
      "Candidate code executed in interview sandbox"
    );

    const checkpointService = require("../services/checkpointService");
    checkpointService.createCheckpoint(session, "EXECUTION", `After ${language} code execution #${canonicalSequence} (exit ${execution.exitCode})`).catch(() => {});

    // Broadcast execution and timeline event to peers in the interview room
    const { getIO } = require("../infrastructure/realtime/socketio");
    const io = getIO();
    if (io && session.roomKey) {
      io.to(`interview:${session.roomKey}`).emit("code_execution_received", {
        execution,
        language,
        senderId: req.user._id,
        offsetMs: calculatedOffset,
      });
      io.to(`interview:${session.roomKey}`).emit("timeline_event_received", timelineEvent);
    }

    return res.json({
      msg: "Execution completed",
      execution,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Interview code execution error");
    return res.status(500).json({ msg: "Code execution failed", error: err.message });
  }
};

/**
 * Run candidate code against multiple test cases (LeetCode-style)
 * POST /api/interviews/:sessionId/run-tests
 */
const { runTestCases } = require("../infrastructure/sandbox/sandboxService");
exports.runTestsInSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { language, code, testCases } = req.body;
    if (Buffer.byteLength(String(code || ""), "utf8") > 100000) {
      return res.status(413).json({ msg: "Code exceeds 100KB limit" });
    }
    const tenantId = req.user.tenantId || "default";
    const session = await InterviewSession.findOne({ _id: sessionId, tenantId });
    if (!session) return res.status(404).json({ msg: "Interview session not found." });
    const uid = String(req.user._id);
    const isSeeker = String(session.seeker) === uid;
    const isRecruiter = String(session.recruiter) === uid;
    const isAdditional = (session.additionalInterviewers || []).some((id) => String(id) === uid);
    if (!isSeeker && !isRecruiter && !isAdditional) return res.status(403).json({ msg: "Not authorized." });
    const result = await runTestCases({ language, code, testCases });
    const calculatedOffset = session.actualStart ? Math.max(0, Date.now() - session.actualStart.getTime()) : 0;
    const timelineEvent = await TimelineEvent.create({
      session: session._id,
      pipeline: "CODING",
      eventType: "code.testRun",
      offsetMs: calculatedOffset,
      participant: req.user._id,
      participantRole: req.user.role || "seeker",
      payload: { text: `Ran ${result.totalCount} tests: ${result.passedCount}/${result.totalCount} passed`, passedCount: result.passedCount, totalCount: result.totalCount, allPassed: result.allPassed, language },
    });
    const { getIO } = require("../infrastructure/realtime/socketio");
    const io = getIO();
    if (io && session.roomKey) io.to(`interview:${session.roomKey}`).emit("timeline_event_received", timelineEvent);
    return res.json({ msg: "Test run completed", ...result });
  } catch (err) {
    logger.error({ err: err.message }, "Run tests error");
    return res.status(500).json({ msg: "Failed running tests", error: err.message });
  }
};

exports.injectTestSocketEvent = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const tenantId = req.user.tenantId || "default";
    const session = await InterviewSession.findOne({ _id: sessionId, tenantId });
    if (!session) return res.status(404).json({ msg: "Session not found" });
    // Brutal fix: enforce participant authorization to prevent IDOR socket injection
    const uid = String(req.user._id || req.user.id);
    const isSeeker = String(session.seeker) === uid;
    const isRecruiter = String(session.recruiter) === uid;
    const isAdditional = (session.additionalInterviewers || []).some((id) => String(id) === uid);
    if (!isSeeker && !isRecruiter && !isAdditional) {
      return res.status(403).json({ msg: "Access denied. Not a participant in this interview." });
    }
    const { getIO } = require("../infrastructure/realtime/socketio");
    const io = getIO();
    if (io && session.roomKey) {
      io.to(`interview:${session.roomKey}`).emit("code_execution_received", req.body);
    }
    return res.json({ msg: "Injected" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const interviewAssistant = require("../modules/ai/interviewAssistant");

/**
 * Generate AI Real-Time Contextual Follow-up Suggestion (Recruiter only)
 * POST /api/interviews/:sessionId/ai-suggest
 */
exports.getAiSuggestion = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { activeCode, activeLanguage, transcriptHistory, currentStage } = req.body;
    const tenantId = req.user.tenantId || "default";

    const session = await InterviewSession.findOne({ _id: sessionId, tenantId })
      .populate("job")
      .populate("activeProblem");

    if (!session) {
      return res.status(404).json({ msg: "Interview session not found." });
    }

    if (session.recruiter.toString() !== req.user._id.toString()) {
      return res.status(403).json({ msg: "Only the interviewer has access to the AI copilot." });
    }

    const suggestion = await interviewAssistant.generateFollowUp({
      session,
      activeCode: activeCode || "",
      activeLanguage: activeLanguage || "python",
      transcriptHistory: transcriptHistory || [],
      currentStage: currentStage || session.stage,
    });

    const calculatedOffset = session.actualStart
      ? Math.max(0, Date.now() - session.actualStart.getTime())
      : 0;

    // Record AI observation to timeline
    await TimelineEvent.create({
      session: session._id,
      pipeline: "AI",
      eventType: "ai.suggestion",
      offsetMs: calculatedOffset,
      participant: req.user._id,
      participantRole: "recruiter",
      payload: {
        aiObservation: suggestion,
      },
    });

    return res.json({ suggestion });
  } catch (err) {
    logger.error({ err: err.message }, "Error generating AI suggestion");
    return res.status(500).json({ msg: "Failed generating AI suggestion" });
  }
};

/**
 * Generate and Save AI Post-Interview Evaluation & Scorecard (Recruiter only)
 * POST /api/interviews/:sessionId/evaluate
 */
exports.evaluateInterview = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { hiringDecision, overallNotes, categories } = req.body;
    const tenantId = req.user.tenantId || "default";

    const session = await InterviewSession.findOne({ _id: sessionId, tenantId })
      .populate("job")
      .populate("seeker")
      .populate("recruiter");

    if (!session) {
      return res.status(404).json({ msg: "Interview session not found." });
    }

    if (session.recruiter._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ msg: "Only the lead interviewer can finalize evaluation." });
    }

    const timelineEvents = await TimelineEvent.find({ session: session._id }).sort({ offsetMs: 1 });

    const aiAssessment = await interviewAssistant.generateEvaluation({
      session,
      timelineEvents,
    });

    // Save or update structured scorecard
    let scorecard = await InterviewScorecard.findOne({ session: session._id });
    if (!scorecard) {
      scorecard = new InterviewScorecard({
        session: session._id,
        evaluator: req.user._id,
        hiringDecision: hiringDecision || aiAssessment.recommendedDecision || "PENDING",
        overallNotes: overallNotes || "",
        categories: categories || [
          {
            category: "Coding & Algorithms",
            score: 4,
            notes: "Evaluated during coding session.",
          },
        ],
        aiAssessment,
      });
    } else {
      if (hiringDecision) scorecard.hiringDecision = hiringDecision;
      if (overallNotes) scorecard.overallNotes = overallNotes;
      if (categories) scorecard.categories = categories;
      scorecard.aiAssessment = aiAssessment;
    }

    try {
      await scorecard.save();
    } catch (saveErr) {
      if (saveErr.name === "ValidationError") {
        return res.status(400).json({ msg: saveErr.message, errors: saveErr.errors });
      }
      throw saveErr;
    }

    // Mark session completed if not already
    if (session.status !== "COMPLETED") {
      session.status = "COMPLETED";
      session.stage = "COMPLETED";
      session.actualEnd = new Date();
      try {
        await session.save();
      } catch (saveErr) {
        if (saveErr.name === "ValidationError") {
          return res.status(400).json({ msg: saveErr.message });
        }
        throw saveErr;
      }
    }

    // Broadcast session status completion over Socket.IO
    const { getIO } = require("../infrastructure/realtime/socketio");
    const io = getIO();
    if (io && session.roomKey) {
      io.to(`interview:${session.roomKey}`).emit("session_status_changed", {
        status: "COMPLETED",
        stage: "COMPLETED",
        actualEnd: session.actualEnd,
      });
    }

    logger.info({ sessionId, decision: scorecard.hiringDecision }, "Interview evaluated and saved");

    return res.json({
      msg: "Interview evaluation saved successfully",
      scorecard,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error evaluating interview session");
    return res.status(500).json({ msg: "Failed evaluating interview" });
  }
};

/**
 * Transition Interview Stage (Recruiter only)
 * PATCH /api/interviews/:sessionId/stage
 */
exports.updateInterviewStage = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { stage, offsetMs } = req.body;
    const tenantId = req.user.tenantId || "default";

    const session = await InterviewSession.findOne({ _id: sessionId, tenantId });
    if (!session) {
      return res.status(404).json({ msg: "Interview session not found" });
    }

    if (session.recruiter.toString() !== req.user._id.toString()) {
      return res.status(403).json({ msg: "Only the lead recruiter can change interview stages." });
    }

    session.transitionStage(stage);
    await session.save();

    // Calculate elapsed offset from actualStart
    const calculatedOffset =
      offsetMs !== undefined
        ? offsetMs
        : session.actualStart
        ? Math.max(0, Date.now() - session.actualStart.getTime())
        : 0;

    const timelineEvent = await TimelineEvent.create({
      session: session._id,
      pipeline: "STAGE",
      eventType: "stage.transition",
      offsetMs: calculatedOffset,
      participant: req.user._id,
      participantRole: "recruiter",
      payload: {
        stage,
        status: session.status,
        text: `Stage changed to ${stage.replace(/_/g, " ")}`,
      },
    });

    const checkpointService = require("../services/checkpointService");
    checkpointService.createCheckpoint(session, "STAGE_TRANSITION", `Transitioned to stage: ${stage}`).catch(() => {});

    // Broadcast stage transition to all room participants in real time
    const { getIO } = require("../infrastructure/realtime/socketio");
    const io = getIO();
    if (io && session.roomKey) {
      io.to(`interview:${session.roomKey}`).emit("stage_updated", {
        stage,
        status: session.status,
        actualStart: session.actualStart,
        offsetMs: calculatedOffset,
      });
      io.to(`interview:${session.roomKey}`).emit("timeline_event_received", timelineEvent);
    }

    logger.info({ sessionId, stage, status: session.status }, "Interview stage updated");

    return res.json({
      msg: `Interview stage updated to ${stage}`,
      session,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Stage transition error");
    return res.status(400).json({ msg: err.message || "Failed updating stage" });
  }
};

/**
 * Transition interview session status (e.g. LIVE, COMPLETED)
 * PATCH or PUT /api/interviews/:sessionId/status
 */
exports.updateInterviewStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { status } = req.body;

    if (!["SCHEDULED", "WAITING_ROOM", "LIVE", "COMPLETED", "CANCELLED"].includes(status)) {
      return res.status(400).json({ msg: "Invalid session status" });
    }
    const tenantId = req.user.tenantId || "default";

    const session = await InterviewSession.findOne({ _id: sessionId, tenantId });
    if (!session) {
      return res.status(404).json({ msg: "Interview session not found" });
    }

    if (session.recruiter.toString() !== req.user._id.toString()) {
      return res.status(403).json({ msg: "Only the lead recruiter can change interview status." });
    }

    if (!session.canTransitionToStatus(status)) {
      return res.status(400).json({ msg: `Invalid status transition from ${session.status} to ${status}` });
    }

    session.transitionStatus(status);
    if (status === "LIVE" && session.stage === "WAITING_ROOM") {
      session.stage = "INTRODUCTION";
    }

    await session.save();

    const calculatedOffset = session.actualStart
      ? Math.max(0, Date.now() - session.actualStart.getTime())
      : 0;

    const timelineEvent = await TimelineEvent.create({
      session: session._id,
      pipeline: "STAGE",
      eventType: "session.status_change",
      offsetMs: calculatedOffset,
      participant: req.user._id,
      participantRole: "recruiter",
      payload: {
        status,
        stage: session.stage,
        text: `Interview session status: ${status}`,
      },
    });

    const { getIO } = require("../infrastructure/realtime/socketio");
    const io = getIO();
    if (io && session.roomKey) {
      io.to(`interview:${session.roomKey}`).emit("session_status_changed", {
        status,
        stage: session.stage,
        actualStart: session.actualStart,
        actualEnd: session.actualEnd,
      });
      io.to(`interview:${session.roomKey}`).emit("timeline_event_received", timelineEvent);
    }

    logger.info({ sessionId, status, stage: session.stage }, "Interview status updated");

    return res.json({
      msg: `Interview status updated to ${status}`,
      session,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Status transition error");
    return res.status(400).json({ msg: err.message || "Failed updating status" });
  }
};

/**
 * List Interviews for Authenticated User (Recruiter or Seeker)
 * GET /api/interviews
 */
exports.getMyInterviews = async (req, res) => {
  try {
    const tenantId = req.user.tenantId || "default";
    const query =
      req.user.role === "recruiter"
        ? { recruiter: req.user._id, tenantId }
        : { seeker: req.user._id, tenantId };

    const interviews = await InterviewSession.find(query)
      .populate("job", "title company location")
      .populate("seeker", "name email")
      .populate("recruiter", "name email")
      .sort({ scheduledStart: -1 })
      .lean();

    return res.json({ interviews });
  } catch (err) {
    logger.error({ err: err.message }, "Error listing interviews");
    return res.status(500).json({ msg: "Failed retrieving interviews" });
  }
};

const livekitService = require("../infrastructure/webrtc/livekitService");

function getPublicLiveKitUrl(req) {
  if (process.env.LIVEKIT_PUBLIC_URL) return process.env.LIVEKIT_PUBLIC_URL;
  if (process.env.LIVEKIT_URL && !/\b(livekit|localhost|127\.0\.0\.1)\b/i.test(process.env.LIVEKIT_URL)) {
    return process.env.LIVEKIT_URL;
  }

  // Never send a hosted browser to its own localhost. When a public URL has
  // not been supplied, make a useful same-host fallback for plain Compose.
  const forwardedHost = req.get("x-forwarded-host");
  const host = (forwardedHost || req.get("host") || "").split(",")[0].trim();
  if (host && !/^localhost(?::|$)|^127\.0\.0\.1(?::|$)/i.test(host)) {
    const hostname = host.replace(/:\d+$/, "");
    const protocol = (req.get("x-forwarded-proto") || req.protocol) === "https" ? "wss" : "ws";
    return `${protocol}://${hostname}:7880`;
  }
  return "ws://localhost:7880";
}

/**
 * Generate signed LiveKit WebRTC token for audio/video communication
 * POST /api/interviews/:sessionId/livekit-token
 */
exports.getLiveKitToken = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const tenantId = req.user.tenantId || "default";
    const session = await InterviewSession.findOne({ _id: sessionId, tenantId });

    if (!session) {
      return res.status(404).json({ msg: "Interview session not found" });
    }

    const uid = String(req.user._id);
    const isSeeker = String(session.seeker) === uid;
    const isRecruiter = String(session.recruiter) === uid;
    const isAdditional = (session.additionalInterviewers || []).some((id) => String(id) === uid);

    if (!isSeeker && !isRecruiter && !isAdditional) {
      return res.status(403).json({ msg: "Access denied. Not a participant in this interview." });
    }

    const token = livekitService.generateLiveKitToken({
      roomKey: session.roomKey,
      participantIdentity: uid,
      participantName: req.user.name,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    // This URL is consumed by the browser, so it must be a public/browser-reachable
    // WebSocket URL rather than the Docker-internal `livekit` hostname.
    const serverUrl = getPublicLiveKitUrl(req);
    if (!/^wss?:\/\//.test(serverUrl)) {
      return res.status(503).json({
        msg: "Live call is misconfigured. LIVEKIT_PUBLIC_URL must start with ws:// or wss://.",
      });
    }

    return res.json({
      token,
      roomKey: session.roomKey,
      serverUrl,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error generating LiveKit token");
    return res.status(500).json({ msg: "Failed generating WebRTC token" });
  }
};

const configParser = require("../services/interviewConfigParser");

/**
 * Parse raw interview config DSL/JSON
 * POST /api/interviews/config/parse
 */
exports.parseConfig = async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ msg: "Config content is required" });
    }
    const parsed = configParser.parseInterviewConfig(content);
    return res.json({ config: parsed });
  } catch (err) {
    return res.status(400).json({ msg: err.message });
  }
};

/**
 * Format interview config object into human-readable DSL
 * POST /api/interviews/config/format
 */
exports.formatConfig = async (req, res) => {
  try {
    const { config } = req.body;
    if (!config) {
      return res.status(400).json({ msg: "Config object is required" });
    }
    const formatted = configParser.formatInterviewConfig(config);
    return res.json({ formatted });
  } catch (err) {
    return res.status(400).json({ msg: err.message });
  }
};

/**
 * POST /api/interviews/:sessionId/invites
 * Lead recruiter creates or rotates an authenticated invitation for an assigned participant
 */
exports.createInterviewInvite = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { audienceUserId, purpose = "CANDIDATE_INVITE", expiresInHours = 72 } = req.body;
    const tenantId = req.user.tenantId || "default";

    const session = await InterviewSession.findOne({ _id: sessionId, tenantId }).populate("seeker recruiter");
    if (!session) {
      return res.status(404).json({ msg: "Interview session not found" });
    }

    if (String(session.recruiter._id || session.recruiter) !== String(req.user._id)) {
      return res.status(403).json({ msg: "Only the lead recruiter can generate invites" });
    }

    const targetUser = audienceUserId || session.seeker._id;
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    // Revoke previous active invites for the same audienceUser
    await InterviewInvite.updateMany(
      { session: session._id, audienceUser: targetUser, usedAt: null, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );

    const invite = await InterviewInvite.create({
      session: session._id,
      audienceUser: targetUser,
      audienceEmailNormalized: session.seeker?.email ? session.seeker.email.toLowerCase() : undefined,
      tokenHash,
      purpose,
      expiresAt,
      createdBy: req.user._id,
    });

    return res.status(201).json({
      msg: "Invite created successfully",
      rawToken,
      inviteUrl: `/join/interview/${rawToken}`,
      expiresAt: invite.expiresAt,
      purpose: invite.purpose,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error creating interview invite");
    return res.status(500).json({ msg: "Failed creating interview invite" });
  }
};

/**
 * GET /api/interviews/invites/validate/:token
 * Check validity of an invite token before login/exchange
 */
exports.validateInterviewInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invite = await InterviewInvite.findOne({
      tokenHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).populate("session audienceUser", "title scheduledStart roomKey name email");

    if (!invite || !invite.session) {
      return res.status(404).json({ msg: "Invitation is invalid, expired, or revoked." });
    }

    invite.lastOpenedAt = new Date();
    await invite.save();

    return res.json({
      valid: true,
      purpose: invite.purpose,
      session: {
        title: invite.session.title,
        scheduledStart: invite.session.scheduledStart,
      },
      assignedUser: {
        name: invite.audienceUser?.name,
      },
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error validating interview invite");
    return res.status(500).json({ msg: "Failed validating invite" });
  }
};

/**
 * POST /api/interviews/invites/accept/:token
 * Authenticated exchange: ensures req.user matches audienceUser
 */
exports.acceptInterviewInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invite = await InterviewInvite.findOne({
      tokenHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).populate("session");

    if (!invite || !invite.session) {
      return res.status(404).json({ msg: "Invitation is invalid, expired, or revoked." });
    }

    if (String(invite.audienceUser) !== String(req.user._id)) {
      return res.status(403).json({
        msg: "This invitation is assigned to a different user account. Please log in with the correct account.",
      });
    }

    // Tenant isolation: ensure invite session belongs to user's tenant
    const tenantId = req.user.tenantId || "default";
    if (invite.session.tenantId && invite.session.tenantId !== tenantId) {
      return res.status(403).json({ msg: "Invitation tenant mismatch. Access denied." });
    }

    invite.usedAt = new Date();
    await invite.save();

    return res.json({
      msg: "Invitation verified successfully",
      roomKey: invite.session.roomKey,
      sessionId: invite.session._id,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error accepting interview invite");
    return res.status(500).json({ msg: "Failed accepting invite" });
  }
};

const { uploadRecordingToS3 } = require("../middleware/videoUpload.middleware.js");
const path = require("path");
const fs = require("fs");

/**
 * POST /api/interviews/:sessionId/recording
 * Upload recorded interview video/audio file from client session
 */
exports.uploadInterviewRecording = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const tenantId = req.user.tenantId || "default";
    const session = await InterviewSession.findOne({ _id: sessionId, tenantId });
    if (!session) {
      return res.status(404).json({ msg: "Interview session not found" });
    }

    // Basic participant authorization for recording upload (IDOR guard)
    const uid = String(req.user._id);
    const isSeeker = String(session.seeker) === uid;
    const isRecruiter = String(session.recruiter) === uid;
    const isAdditional = (session.additionalInterviewers || []).some((id) => String(id) === uid);
    if (!isSeeker && !isRecruiter && !isAdditional) {
      return res.status(403).json({ msg: "Access denied. Not a participant in this interview." });
    }

    if (!req.file) {
      return res.status(400).json({ msg: "No video media file provided" });
    }

    let recordingUrl;
    try {
      const { key, bucket } = await uploadRecordingToS3(sessionId, req.file, req.user._id);
      recordingUrl = `s3://${bucket}/${key}`;
    } catch (s3Err) {
      // Graceful degradation: persist locally when S3/MinIO is unavailable (e.g. test/dev)
      logger.warn({ err: s3Err.message, sessionId }, "S3 recording upload failed, falling back to local storage");
      const ext = (req.file.originalname?.split(".").pop() || "webm").replace(/[^a-zA-Z0-9]/g, "");
      const filename = `${sessionId}-${Date.now()}.${ext}`;
      const dir = path.join(__dirname, "../../uploads/recordings");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), req.file.buffer);
      recordingUrl = `/uploads/recordings/${filename}`;
    }
    session.recordingUrl = recordingUrl;
    await session.save();

    // Add recording milestone event to timeline
    await TimelineEvent.create({
      session: session._id,
      pipeline: "SYSTEM",
      eventType: "recording.saved",
      offsetMs: session.actualStart ? Math.max(0, Date.now() - session.actualStart.getTime()) : 0,
      participant: req.user._id,
      participantRole: req.user.role || "seeker",
      payload: {
        recordingUrl,
        sizeBytes: req.file.size,
        mimetype: req.file.mimetype,
      },
    });

    logger.info({ sessionId, url: recordingUrl, size: req.file.size }, "Interview recording saved successfully to S3");

    return res.status(201).json({
      msg: "Interview recording saved successfully",
      recordingUrl,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error uploading interview recording");
    return res.status(500).json({ msg: "Failed saving interview recording" });
  }
};

/**
 * GET /api/interviews/:sessionId/recording
 * Retrieve current recording URL for session (used by playback/tests)
 */
exports.getInterviewRecording = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const tenantId = req.user.tenantId || "default";
    const session = await InterviewSession.findOne({ _id: sessionId, tenantId }).select("recordingUrl title status");
    if (!session) {
      return res.status(404).json({ msg: "Interview session not found" });
    }
    // Participant authorization (IDOR guard)
    const uid = String(req.user._id);
    const isSeeker = String(session.seeker || "") === uid || String(session.seeker?._id || session.seeker) === uid;
    // For recording fetch, allow any participant; check via full session populate if needed
    const fullSession = await InterviewSession.findOne({ _id: sessionId, tenantId }).select("seeker recruiter additionalInterviewers");
    if (fullSession) {
      const isPart = String(fullSession.seeker) === uid || String(fullSession.recruiter) === uid || (fullSession.additionalInterviewers || []).some((id) => String(id) === uid);
      if (!isPart) return res.status(403).json({ msg: "Access denied. Not a participant in this interview." });
    }
    return res.json({
      sessionId: session._id,
      recordingUrl: session.recordingUrl,
      title: session.title,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error fetching interview recording");
    return res.status(500).json({ msg: "Failed fetching recording" });
  }
};

/**
 * GET /api/interviews/:sessionId/recording/presigned
 * Get presigned upload URL for client-side direct upload to S3
 */
exports.getRecordingPresignedUrl = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const tenantId = req.user.tenantId || "default";
    const session = await InterviewSession.findOne({ _id: sessionId, tenantId }).select("seeker recruiter additionalInterviewers");
    if (!session) {
      return res.status(404).json({ msg: "Interview session not found" });
    }
    const uid = String(req.user._id);
    const isSeeker = String(session.seeker) === uid;
    const isRecruiter = String(session.recruiter) === uid;
    const isAdditional = (session.additionalInterviewers || []).some((id) => String(id) === uid);
    if (!isSeeker && !isRecruiter && !isAdditional) {
      return res.status(403).json({ msg: "Access denied. Not a participant in this interview." });
    }

    const { getPresignedRecordingUploadUrl } = require("../middleware/videoUpload.middleware.js");
    const presignedUrl = await getPresignedRecordingUploadUrl(sessionId, "webm", 7200); // 2 hours

    return res.json({
      presignedUrl,
      key: `recordings/${sessionId}/${sessionId}-${Date.now()}.webm`,
      bucket: require("../config/s3").RECORDINGS_BUCKET,
      expiresIn: 7200,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error generating presigned recording URL");
    return res.status(500).json({ msg: "Failed generating presigned URL" });
  }
};

