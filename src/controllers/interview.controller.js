const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config/env");
const logger = require("../config/logger");
const InterviewSession = require("../models/InterviewSession");
const InterviewProblem = require("../models/InterviewProblem");
const Application = require("../models/Application");
const TimelineEvent = require("../models/TimelineEvent");
const InterviewScorecard = require("../models/InterviewScorecard");

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

  const token = jwt.sign(payload, config.JWT_SECRET || "development_secret_key_12345678", {
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

    const session = await InterviewSession.findById(sessionId)
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

    const session = await InterviewSession.findOne({ roomKey })
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

    return res.json({
      session,
      roomToken,
      role,
      permissions,
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

    const session = await InterviewSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ msg: "Interview session not found." });
    }

    const execution = await executeCodeSandbox({
      language,
      code,
      stdin: stdin || "",
      timeoutMs: 8000,
    });

    const calculatedOffset = session.actualStart
      ? Math.max(0, Date.now() - session.actualStart.getTime())
      : 0;

    // Record execution into the unified timeline
    await TimelineEvent.create({
      session: session._id,
      pipeline: "CODING",
      eventType: "code.execution",
      offsetMs: calculatedOffset,
      participant: req.user._id,
      participantRole: req.user.role || "seeker",
      payload: {
        executionId: execution.executionId,
        language,
        exitCode: execution.exitCode,
        durationMs: execution.durationMs,
        codeSnippet: code.slice(0, 500),
        status: execution.exitCode === 0 ? "success" : execution.timedOut ? "timeout" : "error",
      },
    });

    logger.info(
      { sessionId, language, exitCode: execution.exitCode, durationMs: execution.durationMs },
      "Candidate code executed in interview sandbox"
    );

    const checkpointService = require("../services/checkpointService");
    checkpointService.createCheckpoint(session, "EXECUTION", `After ${language} code execution (exit ${execution.exitCode})`).catch(() => {});

    return res.json({
      msg: "Execution completed",
      execution,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Interview code execution error");
    return res.status(500).json({ msg: "Code execution failed", error: err.message });
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

    const session = await InterviewSession.findById(sessionId)
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

    const session = await InterviewSession.findById(sessionId)
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

    await scorecard.save();

    // Mark session completed if not already
    if (session.status !== "COMPLETED") {
      session.status = "COMPLETED";
      session.stage = "COMPLETED";
      session.actualEnd = new Date();
      await session.save();
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

    const session = await InterviewSession.findById(sessionId);
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

    await TimelineEvent.create({
      session: session._id,
      pipeline: "STAGE",
      eventType: "stage.transition",
      offsetMs: calculatedOffset,
      participant: req.user._id,
      participantRole: "recruiter",
      payload: {
        stage,
        status: session.status,
      },
    });

    const checkpointService = require("../services/checkpointService");
    checkpointService.createCheckpoint(session, "STAGE_TRANSITION", `Transitioned to stage: ${stage}`).catch(() => {});

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
 * List Interviews for Authenticated User (Recruiter or Seeker)
 * GET /api/interviews
 */
exports.getMyInterviews = async (req, res) => {
  try {
    const query =
      req.user.role === "recruiter"
        ? { recruiter: req.user._id }
        : { seeker: req.user._id };

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

/**
 * Generate signed LiveKit WebRTC token for audio/video communication
 * POST /api/interviews/:sessionId/livekit-token
 */
exports.getLiveKitToken = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await InterviewSession.findById(sessionId);

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
    const serverUrl = process.env.LIVEKIT_PUBLIC_URL || process.env.LIVEKIT_URL || "ws://localhost:7880";
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
