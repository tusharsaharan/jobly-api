const { RateLimiterRedis, RateLimiterMemory } = require("rate-limiter-flexible");
const { redis } = require("../config/redis");
const logger = require("../config/logger");

// In-memory twins of every Redis limiter: if Redis is unavailable (or a
// limiter request errors), we degrade to local limiting instead of failing
// the request with 503. Single-process demo deployment makes this exact.
const memoryTwins = new Map();

function getMemoryTwin({ keyPrefix, points, duration }) {
  if (!memoryTwins.has(keyPrefix)) {
    memoryTwins.set(keyPrefix, new RateLimiterMemory({
      keyPrefix: `mem_rl_${keyPrefix}`,
      points,
      duration,
    }));
  }
  return memoryTwins.get(keyPrefix);
}

function createLimiter({ keyPrefix, points, duration }) {
  // Always construct the memory twin eagerly so it exists before any Redis failure.
  getMemoryTwin({ keyPrefix, points, duration });

  try {
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: `rl_${keyPrefix}`,
      points,
      duration,
      execEvenly: false,
      // Never let a limiter request hang or crash the middleware on Redis hiccups.
      insuranceLimiter: getMemoryTwin({ keyPrefix, points, duration }),
    });
  } catch (err) {
    logger.warn({ err: err.message }, "Falling back to in-memory rate limiter");
    return getMemoryTwin({ keyPrefix, points, duration });
  }
}

const authLimiter = createLimiter({ keyPrefix: "auth", points: 10, duration: 60 });
const resumeLimiter = createLimiter({ keyPrefix: "resume", points: 5, duration: 60 });
const aiLimiter = createLimiter({ keyPrefix: "ai", points: 15, duration: 60 });
const generalLimiter = createLimiter({ keyPrefix: "gen", points: 120, duration: 60 });
// B12: per-session extract limit – signals per session per hour per IP+session
const signalsExtractLimiter = createLimiter({ keyPrefix: "signals_extract", points: 100, duration: 3600 });
const signalsSessionLimiter = createLimiter({ keyPrefix: "signals_session", points: 100, duration: 3600 });

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
        // Redis unavailable / limiter error — degrade gracefully instead of 503.
        logger.warn({ err: rejRes.message }, "Rate limiter storage error - allowing request (single-machine demo mode)");
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
  signalsExtractLimiter,
  signalsSessionLimiter,
};
