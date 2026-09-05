const client = require("prom-client");

// Enable default system metrics (CPU, Event Loop, Memory, GC)
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: "jobly_" });

// HTTP Request Duration Histogram
const httpRequestDurationSeconds = new client.Histogram({
  name: "jobly_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
register.registerMetric(httpRequestDurationSeconds);

// Resume Processing Duration Histogram
const resumeProcessingDurationSeconds = new client.Histogram({
  name: "jobly_resume_processing_duration_seconds",
  help: "Duration of asynchronous resume parsing & ATS scoring in seconds",
  labelNames: ["status", "ai_provider"],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
});
register.registerMetric(resumeProcessingDurationSeconds);

// AI Invocation Counter
const aiCallsTotal = new client.Counter({
  name: "jobly_ai_calls_total",
  help: "Total count of external AI provider requests",
  labelNames: ["model", "operation", "status"],
});
register.registerMetric(aiCallsTotal);

// Redis Cache Hit / Miss Counter
const cacheOperationsTotal = new client.Counter({
  name: "jobly_cache_operations_total",
  help: "Total count of cache reads with hits and misses",
  labelNames: ["operation", "status"],
});
register.registerMetric(cacheOperationsTotal);

function metricsMiddleware(req, res, next) {
  const start = process.hrtime();
  res.on("finish", () => {
    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    httpRequestDurationSeconds
      .labels(req.method, route, String(res.statusCode))
      .observe(durationInSeconds);
  });
  next();
}

module.exports = {
  register,
  metricsMiddleware,
  httpRequestDurationSeconds,
  resumeProcessingDurationSeconds,
  aiCallsTotal,
  cacheOperationsTotal,
};
