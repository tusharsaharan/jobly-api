const TimelineEvent = require("../models/TimelineEvent");
const InterviewSignal = require("../models/InterviewSignal");
const InterviewSession = require("../models/InterviewSession");
const {
  evaluatePasteEvent,
  evaluateFocusEvent,
  processIntegrityTelemetry,
} = require("../modules/integrity/integrityTelemetryService");
const {
  trackConnectionIp,
  analyzeWebRtcStats,
} = require("../modules/integrity/networkIntegrityTracker");
const {
  detectPlagiarism,
} = require("../modules/integrity/codeSimilarityEngine");
const logger = require("../config/logger");

/**
 * 1. Ingest Client Telemetry (Paste, Focus/Blur, WebRTC network stats)
 */
async function ingestTelemetry(req, res) {
  try {
    const {
      sessionId,
      eventType,
      offsetMs = 0,
      pasteData,
      focusData,
      rtcStats,
      previousRttMs = 0,
    } = req.body;

    if (!sessionId || !eventType) {
      return res.status(400).json({ success: false, msg: "sessionId and eventType are required" });
    }
    // Participant authorization
    const sessionCheck = await InterviewSession.findById(sessionId).select("seeker recruiter additionalInterviewers tenantId").lean();
    if (!sessionCheck) return res.status(404).json({ success: false, msg: "Interview session not found" });
    const uidIng = String(req.user?._id);
    const isPartIng = String(sessionCheck.seeker) === uidIng || String(sessionCheck.recruiter) === uidIng || (sessionCheck.additionalInterviewers || []).some((id) => String(id) === uidIng);
    if (!isPartIng) return res.status(403).json({ success: false, msg: "Access denied." });
    if (req.user?.tenantId && sessionCheck.tenantId && sessionCheck.tenantId !== req.user.tenantId) return res.status(403).json({ success: false, msg: "Tenant mismatch." });

    const participantId = req.user?._id;
    const participantRole = req.user?.role || "seeker";
    const clientIp = req.ip || req.connection?.remoteAddress || "";
    const userAgent = req.headers["user-agent"] || "";

    let evaluatedPayload = {};

    // 1. IP Continuity Verification
    const ipAnalysis = trackConnectionIp({
      sessionId,
      participantId,
      ipAddress: clientIp,
      userAgent,
    });

    if (ipAnalysis.isAnomalous) {
      await processIntegrityTelemetry({
        sessionId,
        participantId,
        participantRole,
        eventType: "network.anomaly",
        offsetMs,
        payload: {
          clientIp,
          reason: ipAnalysis.reason,
          ipChanges: ipAnalysis.ipChanges,
          subnetChanges: ipAnalysis.subnetChanges,
        },
      });
    }

    // 2. Event-specific handling
    if (eventType === "clipboard.paste" && pasteData) {
      evaluatedPayload = evaluatePasteEvent(pasteData);
    } else if (eventType.startsWith("focus.") && focusData) {
      evaluatedPayload = evaluateFocusEvent(focusData);
    } else if (eventType === "network.webrtc_stats" && rtcStats) {
      evaluatedPayload = analyzeWebRtcStats({
        ...rtcStats,
        previousRttMs: Number(previousRttMs) || 0,
      });
    } else {
      evaluatedPayload = req.body.payload || {};
    }

    const result = await processIntegrityTelemetry({
      sessionId,
      participantId,
      participantRole,
      eventType,
      offsetMs: Number(offsetMs) || 0,
      payload: {
        ...evaluatedPayload,
        clientIp,
      },
    });

    return res.json({
      success: true,
      result,
      evaluation: evaluatedPayload,
      ipAnalysis,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error ingesting integrity telemetry");
    return res.status(500).json({ success: false, msg: err.message });
  }
}

/**
 * 2. Perform Server-Side Code Similarity & Plagiarism Check
 */
async function checkSimilarity(req, res) {
  try {
    const { candidateCode, referenceCorpus = [], threshold = 0.65 } = req.body;

    if (!candidateCode) {
      return res.status(400).json({ success: false, msg: "candidateCode is required" });
    }

    const analysis = detectPlagiarism({
      candidateCode,
      referenceCorpus,
      threshold: Number(threshold) || 0.65,
    });

    return res.json({
      success: true,
      analysis,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error checking code similarity");
    return res.status(500).json({ success: false, msg: err.message });
  }
}

/**
 * 3. Fetch Comprehensive Integrity Report for Interview Session
 */
async function getSessionReport(req, res) {
  try {
    const { sessionId } = req.params;
    // Participant authorization before leaking report
    const sessionCheck = await InterviewSession.findById(sessionId).select("seeker recruiter additionalInterviewers tenantId").lean();
    if (!sessionCheck) return res.status(404).json({ success: false, msg: "Interview session not found" });
    const uidRep = String(req.user?._id);
    const isPartRep = String(sessionCheck.seeker) === uidRep || String(sessionCheck.recruiter) === uidRep || (sessionCheck.additionalInterviewers || []).some((id) => String(id) === uidRep);
    if (!isPartRep) return res.status(403).json({ success: false, msg: "Access denied." });
    if (req.user?.tenantId && sessionCheck.tenantId && sessionCheck.tenantId !== req.user.tenantId) return res.status(403).json({ success: false, msg: "Tenant mismatch." });

    const events = await TimelineEvent.find({
      session: sessionId,
      pipeline: "INTEGRITY",
    })
      .sort({ offsetMs: 1 })
      .lean();

    const signals = await InterviewSignal.find({
      sessionId,
      category: "attention",
    })
      .sort({ offsetMs: 1 })
      .lean();

    const pasteAnomalies = events.filter((e) => e.eventType === "clipboard.paste" && e.payload?.isAnomalous);
    const blurEvents = events.filter((e) => e.eventType?.startsWith("focus."));
    const networkAnomalies = events.filter((e) => e.eventType?.startsWith("network."));

    return res.json({
      success: true,
      report: {
        sessionId,
        totalEvents: events.length,
        pasteAnomaliesCount: pasteAnomalies.length,
        blurEventsCount: blurEvents.length,
        networkAnomaliesCount: networkAnomalies.length,
        events,
        signals,
      },
    });
  } catch (err) {
    logger.error({ err: err.message, sessionId: req.params.sessionId }, "Error fetching integrity report");
    return res.status(500).json({ success: false, msg: err.message });
  }
}

module.exports = {
  ingestTelemetry,
  checkSimilarity,
  getSessionReport,
};
