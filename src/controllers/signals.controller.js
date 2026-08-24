const InterviewSignal = require("../models/InterviewSignal");
const InterviewSession = require("../models/InterviewSession");
const TimelineEvent = require("../models/TimelineEvent");
const { extractAllSignals } = require("../modules/signals/signalExtractor");
const { resolveEvidenceArtifact, createEvidenceReference } = require("../modules/signals/evidenceEngine");
const { scoreInterviewSession } = require("../modules/signals/rubricScorer");
const { getSocketIO } = require("../infrastructure/realtime/socketio");
const logger = require("../config/logger");

/**
 * Extract multi-modal signals from current workspace state
 */
async function extractSignals(req, res) {
  try {
    const {
      sessionId,
      code,
      language,
      activeFile,
      executionResult,
      testCaseResults,
      transcriptSegments,
      whiteboardData,
      focusEvents,
      offsetMs = 0,
      persist = true,
    } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, msg: "sessionId is required" });
    }

    const session = await InterviewSession.findById(sessionId).lean();
    const candidateId = session?.seeker ? String(session.seeker) : String(req.user?._id || "");

    const signals = extractAllSignals({
      sessionId,
      code: code || "",
      language: language || "javascript",
      activeFile: activeFile || "/solution.py",
      executionResult: executionResult || {},
      testCaseResults: testCaseResults || [],
      transcriptSegments: transcriptSegments || [],
      candidateId,
      whiteboardData: whiteboardData || {},
      focusEvents: focusEvents || [],
      offsetMs: Number(offsetMs) || 0,
    });

    if (persist && signals.length > 0) {
      const docs = signals.map((s) => ({
        sessionId,
        category: s.category,
        name: s.name,
        indicator: s.indicator,
        weight: s.weight,
        offsetMs: s.offsetMs,
        payload: s.payload,
        evidenceRef: s.evidenceRef || null,
      }));

      await InterviewSignal.insertMany(docs, { ordered: false }).catch((err) => {
        logger.debug({ err: err.message }, "Signal batch persistence note");
      });
    }

    // Broadcast to room interviewers if socketio available
    const io = getSocketIO();
    if (io && session?.roomKey) {
      io.to(`interview:${session.roomKey}:interviewers`).emit("interview_signals_extracted", {
        sessionId,
        count: signals.length,
        signals,
        offsetMs,
      });
    }

    return res.json({
      success: true,
      count: signals.length,
      signals,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error extracting signals");
    return res.status(500).json({ success: false, msg: err.message });
  }
}

/**
 * Get all persistent signals for an interview session
 */
async function getSignalsBySession(req, res) {
  try {
    const { sessionId } = req.params;
    const signals = await InterviewSignal.find({ sessionId }).sort({ offsetMs: 1 }).lean();

    return res.json({
      success: true,
      count: signals.length,
      signals,
    });
  } catch (err) {
    logger.error({ err: err.message, sessionId: req.params.sessionId }, "Error fetching session signals");
    return res.status(500).json({ success: false, msg: err.message });
  }
}

/**
 * Synthesize all session signals into a 4-pillar competency evaluation
 */
async function evaluateSessionSignals(req, res) {
  try {
    const { sessionId } = req.params;
    const session = await InterviewSession.findById(sessionId)
      .populate("seeker", "name email")
      .populate("recruiter", "name email")
      .lean();

    if (!session) {
      return res.status(404).json({ success: false, msg: "Interview session not found" });
    }

    const timelineEvents = await TimelineEvent.find({ session: sessionId }).sort({ offsetMs: 1 }).lean();
    const signals = await InterviewSignal.find({ sessionId }).sort({ offsetMs: 1 }).lean();

    const candidateId = session.seeker?._id ? String(session.seeker._id) : "candidate-default";
    const interviewerId = session.recruiter?._id ? String(session.recruiter._id) : String(req.user?._id || "recruiter-default");

    // Build evidence references from key timeline events
    const evidenceReferences = [];
    for (const ev of timelineEvents.slice(0, 20)) {
      try {
        const ref = createEvidenceReference({
          type: ev.pipeline === "CODING" ? "CODE_CHECKPOINT" : ev.pipeline === "COMMUNICATION" ? "TRANSCRIPT" : ev.pipeline === "WHITEBOARD" ? "WHITEBOARD_SNAPSHOT" : "TIMELINE_EVENT",
          timelineEventId: ev._id,
          offsetMs: ev.offsetMs || 0,
          locator: {
            file: ev.payload?.file || undefined,
            quote: ev.payload?.text || undefined,
            speaker: ev.participantRole || "Candidate",
          },
          summary: `${ev.pipeline} event: ${ev.eventType}`,
        });
        evidenceReferences.push(ref);
      } catch (e) {
        // Skip invalid synthetic events
      }
    }

    const evaluation = scoreInterviewSession({
      signals,
      evidenceReferences,
      sessionId,
      candidateId,
      interviewerId,
    });

    return res.json({
      success: true,
      evaluation,
    });
  } catch (err) {
    logger.error({ err: err.message, sessionId: req.params.sessionId }, "Error evaluating session signals");
    return res.status(500).json({ success: false, msg: err.message });
  }
}

/**
 * Resolve an evidence reference into displayable code snippets or transcript quotes
 */
async function resolveEvidence(req, res) {
  try {
    const { evidenceRef, sessionId } = req.body;
    if (!evidenceRef) {
      return res.status(400).json({ success: false, msg: "evidenceRef is required" });
    }

    const resolved = await resolveEvidenceArtifact(evidenceRef, sessionId);
    return res.json({
      success: true,
      resolvedEvidence: resolved,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error resolving evidence reference");
    return res.status(500).json({ success: false, msg: err.message });
  }
}

module.exports = {
  extractSignals,
  getSignalsBySession,
  evaluateSessionSignals,
  resolveEvidence,
};
