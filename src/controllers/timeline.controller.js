const logger = require("../config/logger");
const InterviewSession = require("../models/InterviewSession");
const TimelineEvent = require("../models/TimelineEvent");

/**
 * Authorize participant for timeline access
 */
async function authorizeParticipant(sessionIdOrRoomKey, user) {
  const session = await InterviewSession.findOne({
    $or: [
      { _id: sessionIdOrRoomKey.match(/^[0-9a-fA-F]{24}$/) ? sessionIdOrRoomKey : null },
      { roomKey: sessionIdOrRoomKey },
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

/**
 * GET /api/timeline/:sessionId/events
 * Query paginated events with pipeline and offset filters
 */
exports.getTimelineEvents = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const {
      pipeline,
      eventType,
      participantId,
      from = 0,
      to = 999999999,
      limit = 100,
      offset = 0,
    } = req.query;

    const session = await authorizeParticipant(sessionId, req.user);

    const query = {
      session: session._id,
      offsetMs: { $gte: Number(from), $lte: Number(to) },
    };

    if (pipeline) query.pipeline = pipeline.toUpperCase();
    if (eventType) query.eventType = eventType;
    if (participantId) query.participant = participantId;

    const total = await TimelineEvent.countDocuments(query);
    const events = await TimelineEvent.find(query)
      .populate("participant", "name role email")
      .sort({ offsetMs: 1, createdAt: 1 })
      .skip(Number(offset))
      .limit(Number(limit))
      .lean();

    return res.json({
      events,
      total,
      hasMore: Number(offset) + events.length < total,
      offset: Number(offset),
      limit: Number(limit),
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error fetching timeline events");
    return res.status(err.status || 500).json({ msg: err.message || "Failed fetching timeline events" });
  }
};

/**
 * GET /api/timeline/:sessionId/events/:eventId
 * Retrieve single timeline event details
 */
exports.getTimelineEventById = async (req, res) => {
  try {
    const { sessionId, eventId } = req.params;
    const session = await authorizeParticipant(sessionId, req.user);

    const event = await TimelineEvent.findOne({
      _id: eventId,
      session: session._id,
    }).populate("participant", "name role email");

    if (!event) {
      return res.status(404).json({ msg: "Timeline event not found" });
    }

    return res.json({ event });
  } catch (err) {
    logger.error({ err: err.message }, "Error fetching single timeline event");
    return res.status(err.status || 500).json({ msg: err.message || "Failed fetching timeline event" });
  }
};

/**
 * GET /api/timeline/:sessionId/events/:eventId/context
 * Retrieve contextual surrounding events window (before & after)
 */
exports.getTimelineEventContext = async (req, res) => {
  try {
    const { sessionId, eventId } = req.params;
    const { window = 5 } = req.query;
    const session = await authorizeParticipant(sessionId, req.user);

    const targetEvent = await TimelineEvent.findOne({
      _id: eventId,
      session: session._id,
    }).populate("participant", "name role email");

    if (!targetEvent) {
      return res.status(404).json({ msg: "Target event not found" });
    }

    const windowSize = Number(window);

    const beforeEvents = await TimelineEvent.find({
      session: session._id,
      offsetMs: { $lte: targetEvent.offsetMs },
      _id: { $ne: targetEvent._id },
    })
      .populate("participant", "name role email")
      .sort({ offsetMs: -1, createdAt: -1 })
      .limit(windowSize)
      .lean();

    const afterEvents = await TimelineEvent.find({
      session: session._id,
      offsetMs: { $gte: targetEvent.offsetMs },
      _id: { $ne: targetEvent._id },
    })
      .populate("participant", "name role email")
      .sort({ offsetMs: 1, createdAt: 1 })
      .limit(windowSize)
      .lean();

    return res.json({
      targetEvent,
      before: beforeEvents.reverse(),
      after: afterEvents,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error fetching event context window");
    return res.status(err.status || 500).json({ msg: err.message || "Failed fetching context window" });
  }
};

/**
 * GET /api/timeline/:sessionId/search
 * Full text search across transcript, code, notes, and execution results
 */
exports.searchTimeline = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { q, limit = 50 } = req.query;

    if (!q || !q.trim()) {
      return res.status(400).json({ msg: "Search query 'q' parameter is required" });
    }

    const session = await authorizeParticipant(sessionId, req.user);
    const regex = new RegExp(q.trim(), "i");

    // Multi-attribute search across payload text, codeSnippet, and eventType
    const results = await TimelineEvent.find({
      session: session._id,
      $or: [
        { "payload.text": regex },
        { "payload.codeSnippet": regex },
        { "payload.stage": regex },
        { eventType: regex },
      ],
    })
      .populate("participant", "name role email")
      .sort({ offsetMs: 1 })
      .limit(Number(limit))
      .lean();

    return res.json({
      query: q.trim(),
      count: results.length,
      results,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error searching timeline");
    return res.status(err.status || 500).json({ msg: err.message || "Failed searching timeline" });
  }
};
