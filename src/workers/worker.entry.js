require("dotenv").config();
const { Worker } = require("bullmq");
const { redis } = require("../config/redis");
const connectDB = require("../config/db");
const logger = require("../config/logger");
const { processResumeJob } = require("./resume.processor");

async function startWorker() {
  await connectDB();
  logger.info("👷 Worker process connected to MongoDB");

  const resumeWorker = new Worker(
    "resume-processing",
    async (job) => {
      logger.info({ jobId: job.id, name: job.name }, "Processing resume job");
      return await processResumeJob(job.data);
    },
    {
      connection: redis,
      concurrency: 5, // Process up to 5 resumes concurrently
    }
  );

  resumeWorker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Job completed successfully");
  });

  resumeWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "Job failed with error");
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info({ signal }, "Worker shutting down gracefully");
    await resumeWorker.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("🚀 Background Worker ready and listening for jobs");
}

if (require.main === module) {
  startWorker().catch((err) => {
    logger.error({ err: err.message }, "Worker failed to start");
    process.exit(1);
  });
}

module.exports = { startWorker };
