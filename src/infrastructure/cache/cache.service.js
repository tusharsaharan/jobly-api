const { redis } = require("../../config/redis");
const logger = require("../../config/logger");
const { cacheOperationsTotal } = require("../observability/metrics");

class CacheService {
  async get(key) {
    if (!redis || redis.status !== "ready") return null;
    try {
      const data = await redis.get(key);
      if (data) {
        cacheOperationsTotal.labels("get", "hit").inc();
        return JSON.parse(data);
      }
      cacheOperationsTotal.labels("get", "miss").inc();
      return null;
    } catch (err) {
      logger.warn({ err: err.message, key }, "Cache get error");
      return null;
    }
  }

  async set(key, value, ttlSeconds = 300) {
    if (!redis || redis.status !== "ready") return;
    try {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      logger.warn({ err: err.message, key }, "Cache set error");
    }
  }

  async del(key) {
    if (!redis || redis.status !== "ready") return;
    try {
      await redis.del(key);
    } catch (err) {
      logger.warn({ err: err.message, key }, "Cache del error");
    }
  }

  async invalidatePattern(pattern) {
    if (!redis || redis.status !== "ready") return;
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      logger.warn({ err: err.message, pattern }, "Cache invalidatePattern error");
    }
  }
}

const cacheService = new CacheService();

module.exports = cacheService;
