const { redis } = require("../../config/redis");
const logger = require("../../config/logger");

const STREAM_NAME = "jobly:domain-events";

async function publishDomainEvent(eventType, payload) {
  try {
    if (!redis || redis.status !== "ready") {
      logger.debug({ eventType }, "Redis stream offline, skipping non-critical stream publish");
      return;
    }
    const message = {
      type: eventType,
      payload: JSON.stringify(payload),
      timestamp: Date.now().toString(),
    };
    await redis.xadd(STREAM_NAME, "*", "event", JSON.stringify(message));
  } catch (err) {
    logger.warn({ err: err.message, eventType }, "Failed publishing domain event to Redis stream");
  }
}

module.exports = {
  STREAM_NAME,
  publishDomainEvent,
};
