const { Queue } = require("bullmq");
const { redis } = require("../../config/redis");
const logger = require("../../config/logger");

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1500,
  },
  removeOnComplete: {
    age: 3600, // keep completed jobs for 1 hr
    count: 500,
  },
  removeOnFail: {
    age: 86400, // keep failed jobs for 24 hrs for debugging/dead-letter inspection
  },
};

let resumeProcessingQueue;
let notificationQueue;

if (process.env.NODE_ENV === "test") {
  // Mock queues for in-memory unit/integration test isolation
  const createMockQueue = () => ({
    add: async (name, data) => ({ id: "mock-job-id", name, data }),
    getJob: async (id) => ({ id, getState: async () => "completed", progress: 100 }),
    close: async () => {},
  });
  resumeProcessingQueue = createMockQueue();
  notificationQueue = createMockQueue();
} else {
  resumeProcessingQueue = new Queue("resume-processing", {
    connection: redis,
    defaultJobOptions,
  });

  notificationQueue = new Queue("notifications", {
    connection: redis,
    defaultJobOptions,
  });
}

module.exports = {
  resumeProcessingQueue,
  notificationQueue,
};
