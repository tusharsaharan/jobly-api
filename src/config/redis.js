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
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      autoResubscribe: true,
      lazyConnect: false,
      retryStrategy(times) {
        // Bounded reconnect: 200ms..5s forever — a transient Redis restart
        // must never permanently brick rate limiting/queues (demo killer).
        return Math.min(times * 200, 5000);
      },
      reconnectOnError(err) {
        // Reconnect on read-only/NOAUTH style errors so the client self-heals.
        const targets = ["READONLY", "NOAUTH", "ERR"];
        return targets.some((t) => String(err?.message || "").includes(t)) ? 2 : false;
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
