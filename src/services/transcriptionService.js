const logger = require("../config/logger");
const TimelineEvent = require("../models/TimelineEvent");
const InterviewSession = require("../models/InterviewSession");

/**
 * Ingest and record an audio transcript segment to the Unified Timeline
 */
async function recordTranscriptSegment({
  sessionId,
  participantId,
  participantRole,
  text,
  isFinal = true,
  offsetMs,
}) {
  try {
    if (!text || !text.trim()) return null;

    const session = await InterviewSession.findById(sessionId);
    if (!session) return null;

    const calculatedOffset =
      offsetMs !== undefined
        ? offsetMs
        : session.actualStart
        ? Math.max(0, Date.now() - new Date(session.actualStart).getTime())
        : 0;

    const event = await TimelineEvent.create({
      session: session._id,
      pipeline: "COMMUNICATION",
      eventType: isFinal ? "transcript.final" : "transcript.interim",
      offsetMs: calculatedOffset,
      participant: participantId || null,
      participantRole: participantRole || "seeker",
      payload: {
        text: text.trim(),
        isFinal,
      },
    });

    logger.debug(
      { sessionId, offsetMs: calculatedOffset, isFinal },
      "Recorded speech transcript segment to timeline"
    );

    return event;
  } catch (err) {
    logger.error({ err: err.message, sessionId }, "Error recording transcript segment");
    return null;
  }
}

/**
 * Format raw audio stream transcription into structured dialogue log
 */
function formatDialogueHistory(timelineEvents) {
  return timelineEvents
    .filter((e) => e.pipeline === "COMMUNICATION")
    .map((e) => ({
      speaker: e.participant?.name || e.participantRole || "Speaker",
      role: e.participantRole,
      text: e.payload?.text || "",
      offsetMs: e.offsetMs,
      timestamp: e.createdAt,
    }));
}

module.exports = {
  recordTranscriptSegment,
  formatDialogueHistory,
};
