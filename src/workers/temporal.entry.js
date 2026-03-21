require("dotenv").config();
const { Worker } = require("@temporalio/worker");
const activities = require("../infrastructure/temporal/activities/resumeActivities");
const connectDB = require("../config/db");
const logger = require("../config/logger");

async function runTemporalWorker() {
  await connectDB();
  logger.info("👷 Temporal Worker connected to MongoDB datastore");

  const address = process.env.TEMPORAL_ADDRESS || "localhost:7233";

  try {
    const worker = await Worker.create({
      workflowsPath: require.resolve("../infrastructure/temporal/workflows/resumeProcessing.workflow"),
      activities,
      taskQueue: "resume-processing-queue",
      address,
    });

    logger.info({ taskQueue: "resume-processing-queue" }, "🚀 Temporal Worker listening on task queue");
    await worker.run();
  } catch (err) {
    logger.error({ err: err.message }, "Temporal Worker failed to connect to Temporal cluster");
  }
}

if (require.main === module) {
  runTemporalWorker().catch((err) => {
    logger.error({ err: err.message }, "Temporal Worker fatal crash");
    process.exit(1);
  });
}

module.exports = { runTemporalWorker };
