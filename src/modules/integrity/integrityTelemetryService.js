const TimelineEvent = require("../../models/TimelineEvent");
const InterviewSignal = require("../../models/InterviewSignal");
const logger = require("../../config/logger");

/**
 * 1. Evaluate Paste Velocity and Keystroke Anomaly Heuristics
 */
function evaluatePasteEvent({ text = "", characterCount = 0, durationMs = 0, lineCount = 1 }) {
  const count = characterCount || text.length;
  const dur = Math.max(durationMs || 0, 50); // Minimum 50ms floor
  const charsPerSec = (count / dur) * 1000;

  let classification = "normal_paste";
  let isAnomalous = false;
  let severity = "low";
  let explanation = "Standard small clipboard insertion.";

  if (count >= 150 && dur <= 200) {
    // Instantaneous large clipboard dump
    classification = "instant_bulk_paste";
    isAnomalous = true;
    severity = count > 500 ? "high" : "medium";
    explanation = `Instant paste of ${count} characters (${lineCount} lines) in ${dur}ms.`;
  } else if (count >= 200 && charsPerSec > 45 && charsPerSec < 200) {
    // Simulated robotic / scripted typing burst
    classification = "simulated_keystroke_burst";
    isAnomalous = true;
    severity = "medium";
    explanation = `High-frequency synthetic keystroke burst (${Math.round(charsPerSec)} chars/sec). Exceeds human typing limits.`;
  } else if (count >= 50) {
    classification = "moderate_paste";
    explanation = `Pasted ${count} characters.`;
  }

  return {
    isAnomalous,
    classification,
    severity,
    characterCount: count,
    durationMs: dur,
    charsPerSec: Math.round(charsPerSec),
    lineCount,
    explanation,
  };
}

/**
 * 2. Evaluate Browser Focus & Visibility Changes
 */
function evaluateFocusEvent({ type = "blur", durationMs = 0 }) {
  let isAnomalous = false;
  let severity = "low";
  let explanation = "Tab visibility state changed.";

  if (type === "fullscreen_exit") {
    isAnomalous = true;
    severity = "medium";
    explanation = "Candidate exited fullscreen interview workspace.";
  } else if (type === "blur" && durationMs > 15000) {
    isAnomalous = true;
    severity = durationMs > 60000 ? "high" : "medium";
    explanation = `Candidate switched away from interview workspace for ${Math.round(durationMs / 1000)}s.`;
  }

  return {
    type,
    isAnomalous,
    severity,
    durationMs,
    explanation,
  };
}

/**
 * 3. Ingest and Persist Integrity Event into Timeline and Signals
 */
async function processIntegrityTelemetry({
  sessionId,
  participantId,
  participantRole = "seeker",
  eventType,
  offsetMs = 0,
  payload = {},
}) {
  try {
    let timelineEvent = null;
    if (payload.isAnomalous || (eventType === "clipboard.paste" && payload.characterCount > 100) || eventType === "network.anomaly") {
      timelineEvent = await TimelineEvent.create({
        session: sessionId,
        pipeline: "INTEGRITY",
        eventType,
        offsetMs,
        participant: participantId,
        participantRole,
        payload,
      });
    }

    // If marked anomalous or noteworthy, generate InterviewSignal
    let signalName = null;
    let indicator = "neutral";
    let weight = 1.0;

    if (eventType === "clipboard.paste" && payload.isAnomalous) {
      signalName = "integrity_bulk_paste_anomaly";
      indicator = "concern";
      weight = payload.severity === "high" ? 2.5 : 1.5;
    } else if (eventType === "focus.blur" && payload.isAnomalous) {
      signalName = "integrity_extended_window_blur";
      indicator = "concern";
      weight = 2.0;
    } else if (eventType === "network.anomaly") {
      signalName = "integrity_network_ip_shift";
      indicator = "concern";
      weight = 1.5;
    }

    if (signalName) {
      await InterviewSignal.create({
        sessionId,
        category: "attention",
        name: signalName,
        indicator,
        weight,
        offsetMs,
        payload,
      });
    }

    return { success: true, timelineEventId: timelineEvent._id };
  } catch (err) {
    logger.warn({ err: err.message, sessionId, eventType }, "Error persisting integrity telemetry");
    return { success: false, error: err.message };
  }
}

module.exports = {
  evaluatePasteEvent,
  evaluateFocusEvent,
  processIntegrityTelemetry,
};
