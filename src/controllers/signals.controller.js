const mongoose = require("mongoose");
const InterviewSignal = require("../models/InterviewSignal");
const InterviewSession = require("../models/InterviewSession");
const TimelineEvent = require("../models/TimelineEvent");
const { extractAllSignals } = require("../modules/signals/signalExtractor");
const { resolveEvidenceArtifact, createEvidenceReference, computeVerificationHash, verifyEvidenceReference } = require("../modules/signals/evidenceEngine");
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

    // B13: Validate sessionId is valid ObjectId before findById to avoid CastError -> 500
    if (!mongoose.Types.ObjectId.isValid(String(sessionId))) {
      return res.status(400).json({ success: false, msg: "Invalid sessionId format" });
    }

    const session = await InterviewSession.findById(sessionId).lean();
    // Participant authorization — prevent any user from injecting signals for arbitrary session
    if (session) {
      const uid = String(req.user?._id);
      const isSeeker = String(session.seeker) === uid;
      const isRecruiter = String(session.recruiter) === uid;
      const isAdditional = (session.additionalInterviewers || []).some((id) => String(id) === uid);
      if (!isSeeker && !isRecruiter && !isAdditional) {
        return res.status(403).json({ success: false, msg: "Access denied. Not a participant." });
      }
      if (req.user?.tenantId && session.tenantId && session.tenantId !== req.user.tenantId) {
        return res.status(403).json({ success: false, msg: "Tenant mismatch." });
      }
    } else {
      return res.status(404).json({ success: false, msg: "Interview session not found" });
    }
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

      try {
        await InterviewSignal.insertMany(docs, { ordered: false });
      } catch (err) {
        logger.error({ err: err.message, sessionId }, "Signal batch persistence failed");
        return res.status(500).json({ success: false, msg: err.message || "Failed to persist signals" });
      }
    }

    // Broadcast to room interviewers if socketio available — plan requires interview_signal_emitted + evidence_created
    const io = getSocketIO();
    if (io && session?.roomKey) {
      // Debounced emit: batch signals as single event to avoid congestion
      io.to(`interview:${session.roomKey}:interviewers`).emit("interview_signals_extracted", {
        sessionId,
        count: signals.length,
        signals,
        offsetMs,
      });
      // Canonical plan event names
      for (const sig of signals.slice(0, 20)) {
        io.to(`interview:${session.roomKey}:interviewers`).emit("interview_signal_emitted", {
          sessionId,
          signal: sig,
          offsetMs: sig.offsetMs,
          emittedAt: new Date().toISOString(),
        });
        if (sig.evidenceRef) {
          io.to(`interview:${session.roomKey}:interviewers`).emit("evidence_created", {
            sessionId,
            evidenceRef: sig.evidenceRef,
            signalName: sig.name,
          });
        }
      }
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
    // Authorize participant before leaking signals
    const session = await InterviewSession.findById(sessionId).select("seeker recruiter additionalInterviewers tenantId").lean();
    if (!session) return res.status(404).json({ success: false, msg: "Interview session not found" });
    const uid = String(req.user?._id);
    const isSeeker = String(session.seeker) === uid;
    const isRecruiter = String(session.recruiter) === uid;
    const isAdditional = (session.additionalInterviewers || []).some((id) => String(id) === uid);
    if (!isSeeker && !isRecruiter && !isAdditional) return res.status(403).json({ success: false, msg: "Access denied." });
    if (req.user?.tenantId && session.tenantId && session.tenantId !== req.user.tenantId) return res.status(403).json({ success: false, msg: "Tenant mismatch." });
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
    // Participant check
    if (session) {
      const uid = String(req.user?._id);
      const isSeeker = String(session.seeker?._id || session.seeker) === uid;
      const isRecruiter = String(session.recruiter?._id || session.recruiter) === uid;
      const isAdditional = (session.additionalInterviewers || []).some((id) => String(id?._id || id) === uid);
      if (!isSeeker && !isRecruiter && !isAdditional) return res.status(403).json({ success: false, msg: "Access denied." });
      if (req.user?.tenantId && session.tenantId && session.tenantId !== req.user.tenantId) return res.status(403).json({ success: false, msg: "Tenant mismatch." });
    }

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
    const evidenceRef = req.body.evidenceRef || req.body.evidence || req.params.evidenceRef;
    const sessionId = req.body.sessionId || req.params.sessionId || req.body.sessionId;
    const ref = evidenceRef || req.body;
    if (!ref || !ref.id) {
      return res.status(400).json({ success: false, msg: "evidenceRef is required" });
    }
    // B7: Verify hash before resolving – reject tampered evidence with 400
    const verification = await verifyEvidenceReference(ref, sessionId || null);
    if (!verification.valid) {
      return res.status(400).json({ success: false, msg: verification.reason || "Evidence verification failed" });
    }
    const resolved = await resolveEvidenceArtifact(ref, sessionId);
    return res.json({
      success: true,
      resolvedEvidence: resolved,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error resolving evidence reference");
    return res.status(500).json({ success: false, msg: err.message });
  }
}

async function resolveEvidenceById(req, res) {
  try {
    const { evidenceId } = req.params;
    const { sessionId } = req.query;
    // Search InterviewSignal evidenceRef or TimelineEvent
    const signal = await InterviewSignal.findOne({ "evidenceRef.id": evidenceId, ...(sessionId ? { sessionId } : {}) }).lean();
    if (signal?.evidenceRef) {
      // B7: verify hash before resolving
      const verification = await verifyEvidenceReference(signal.evidenceRef, signal.sessionId);
      if (!verification.valid) {
        return res.status(400).json({ success: false, msg: verification.reason || "Evidence verification failed" });
      }
      const resolved = await resolveEvidenceArtifact(signal.evidenceRef, signal.sessionId);
      return res.json({ success: true, resolvedEvidence: resolved });
    }
    // Fallback to evaluation evidence search
    const Evaluation = require("../models/Evaluation");
    const evaluation = await Evaluation.findOne({ "competencies.evidenceRefs._id": evidenceId }).lean();
    if (evaluation) {
      for (const comp of evaluation.competencies || []) {
        const match = (comp.evidenceRefs || []).find((r) => String(r._id) === String(evidenceId));
        if (match) {
          const type = match.refType || "TIMELINE_EVENT";
          const offsetMs = Number.isFinite(Number(match.offsetMs)) ? Math.max(0, Math.floor(Number(match.offsetMs))) : 0;
          const locator = {};
          if (match.quote) locator.quote = String(match.quote).slice(0, 500);
          if (match.note) locator.file = String(match.note).slice(0, 500);
          const summary = match.note || "Evidence";
          let verificationHash = match.verificationHash;
          const isPlaceholder = !verificationHash || String(verificationHash).startsWith("pending") || verificationHash === "fallbackhash12345678";
          if (isPlaceholder) {
            try {
              if (match.timelineEventId) {
                const ref = createEvidenceReference({
                  type,
                  timelineEventId: String(match.timelineEventId),
                  offsetMs,
                  locator,
                  summary,
                });
                verificationHash = ref.verificationHash;
              } else {
                verificationHash = computeVerificationHash(type, offsetMs, locator, summary);
              }
            } catch (_) {
              verificationHash = computeVerificationHash(type, offsetMs, locator, summary);
            }
          }
          const evidenceRefForResolve = {
            id: String(match._id),
            type,
            timelineEventId: match.timelineEventId ? String(match.timelineEventId) : String(evaluation.session),
            offsetMs,
            locator,
            summary,
            verificationHash,
          };
          // B7: verify hash before resolving evaluation evidence
          const verification = await verifyEvidenceReference(evidenceRefForResolve, evaluation.session);
          if (!verification.valid) {
            return res.status(400).json({ success: false, msg: verification.reason || "Evidence verification failed" });
          }
          const resolved = await resolveEvidenceArtifact(evidenceRefForResolve, evaluation.session);
          return res.json({ success: true, resolvedEvidence: resolved, evidenceRef: match });
        }
      }
    }
    return res.status(404).json({ success: false, msg: "Evidence not found" });
  } catch (err) {
    logger.error({ err: err.message }, "Error resolving evidence by id");
    return res.status(500).json({ success: false, msg: err.message });
  }
}

module.exports = {
  extractSignals,
  getSignalsBySession,
  evaluateSessionSignals,
  resolveEvidence,
  resolveEvidenceById,
};
