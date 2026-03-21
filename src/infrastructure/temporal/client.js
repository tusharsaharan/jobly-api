const { Connection, Client } = require("@temporalio/client");
const logger = require("../../config/logger");

let temporalClient = null;

async function getTemporalClient() {
  if (!temporalClient) {
    try {
      const address = process.env.TEMPORAL_ADDRESS || "localhost:7233";
      const connection = await Connection.connect({ address });
      temporalClient = new Client({ connection });
      logger.info({ address }, "⚡ Connected to Temporal Orchestration Server");
    } catch (err) {
      if (process.env.NODE_ENV !== "test") {
        logger.warn({ err: err.message }, "Temporal cluster offline, will use BullMQ fallback executor");
      }
      return null;
    }
  }
  return temporalClient;
}

module.exports = {
  getTemporalClient,
};
