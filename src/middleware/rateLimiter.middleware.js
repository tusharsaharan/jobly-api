const { RateLimiterRedis, RateLimiterMemory } = require("rate-limiter-flexible");
const { redis } = require("../config/redis");
const logger = require("../config/logger");

function createLimiter({ keyPrefix, points, duration }) {
  try {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: `rl_${keyPrefix}`,
      points,
      duration,
      execEvenly: false,
    });
  } catch (err) {
    logger.warn({ err: err.message }, "Falling back to in-memory rate limiter");
    return new RateLimiterMemory({
      keyPrefix: `mem_rl_${keyPrefix}`,
      points,
      duration,
    });
  }
}

const authLimiter = createLimiter({ keyPrefix: "auth", points: 10, duration: 60 });
const resumeLimiter = createLimiter({ keyPrefix: "resume", points: 5, duration: 60 });
const aiLimiter = createLimiter({ keyPrefix: "ai", points: 15, duration: 60 });
const generalLimiter = createLimiter({ keyPrefix: "gen", points: 120, duration: 60 });

function rateLimitMiddleware(limiter, keyGenerator = (req) => req.user?._id?.toString() || req.ip) {
  return async (req, res, next) => {
    if (process.env.NODE_ENV === "test") return next();
    try {
      const key = keyGenerator(req);
      const resLimit = await limiter.consume(key);
      res.setHeader("X-RateLimit-Limit", limiter.points);
      res.setHeader("X-RateLimit-Remaining", resLimit.remainingPoints);
      res.setHeader("X-RateLimit-Reset", new Date(Date.now() + resLimit.msBeforeNext).toISOString());
      next();
    } catch (rejRes) {
      if (rejRes instanceof Error) {
        // Redis error, allow request through to not block traffic
        return next();
      }
      res.setHeader("Retry-After", Math.round(rejRes.msBeforeNext / 1000) || 1);
      return res.status(429).json({
        msg: "Too many requests. Please slow down.",
        retryAfterSeconds: Math.round(rejRes.msBeforeNext / 1000) || 1,
      });
    }
  };
}

module.exports = {
  rateLimitMiddleware,
  authLimiter,
  resumeLimiter,
  aiLimiter,
  generalLimiter,
};
