const Redis = require("ioredis");
const config = require("./env");
const logger = require("./logger");

let redisClient = null;

function getRedisClient() {
  if (!redisClient) {
    const options = {
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 0,
      enableReadyCheck: false,
      autoResubscribe: false,
      lazyConnect: true,
      retryStrategy() {
        return null;
      },
    };

    try {
      redisClient = new Redis(options);
      redisClient.on("error", () => {});
    } catch {
      redisClient = null;
    }
  }

  return redisClient;
}

module.exports = {
  getRedisClient,
  redis: getRedisClient(),
};
