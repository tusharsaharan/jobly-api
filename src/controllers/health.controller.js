const mongoose = require("mongoose");
const { redis } = require("../config/redis");
const { s3Client } = require("../config/s3");
const { ListBucketsCommand } = require("@aws-sdk/client-s3");
const logger = require("../config/logger");

async function checkHealth(req, res) {
  const status = {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    status: "ok",
    checks: {
      mongodb: "unknown",
      redis: "unknown",
      storage: "unknown",
    },
  };

  // 1. MongoDB check
  try {
    const mongoState = mongoose.connection.readyState;
    status.checks.mongodb = mongoState === 1 ? "healthy" : "degraded";
  } catch (err) {
    status.checks.mongodb = "unhealthy";
    status.status = "degraded";
  }

  // 2. Redis check
  try {
    if (redis && redis.status === "ready") {
      await redis.ping();
      status.checks.redis = "healthy";
    } else {
      status.checks.redis = "degraded";
    }
  } catch (err) {
    status.checks.redis = "unhealthy";
    status.status = "degraded";
  }

  // 3. S3/MinIO check
  try {
    if (process.env.NODE_ENV !== "test") {
      await s3Client.send(new ListBucketsCommand({}));
      status.checks.storage = "healthy";
    } else {
      status.checks.storage = "healthy";
    }
  } catch (err) {
    status.checks.storage = "degraded";
  }

  const statusCode = status.status === "ok" ? 200 : 207;
  return res.status(statusCode).json(status);
}

module.exports = {
  checkHealth,
};
