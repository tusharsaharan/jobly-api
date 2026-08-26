const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const pinoHttp = require("pino-http");
const logger = require("./config/logger");
const requestIdMiddleware = require("./middleware/requestId.middleware");
const { metricsMiddleware } = require("./infrastructure/telemetry/telemetry");
const { rateLimitMiddleware, generalLimiter } = require("./middleware/rateLimiter.middleware");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const jobRoutes = require("./routes/job.routes");
const resumeRoutes = require("./routes/resume.routes");
const applicationRoutes = require("./routes/application.routes");
const messageRoutes = require("./routes/message.routes");
const interviewRoutes = require("./routes/interview.routes");
const codingRoutes = require("./routes/coding.routes");
const whiteboardRoutes = require("./routes/whiteboard.routes");
const timelineRoutes = require("./routes/timeline.routes");
const evaluationRoutes = require("./routes/evaluation.routes");
const replayRoutes = require("./routes/replay.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const healthRoutes = require("./routes/health.routes");
const interviewNoteRoutes = require("./routes/interviewNote.routes");
const atsRoutes = require("./routes/ats.routes");
const signalsRoutes = require("./routes/signals.routes");
const integrityRoutes = require("./routes/integrity.routes");
const learnRoutes = require("./routes/learn.routes");
const competitionRoutes = require("./routes/competition.routes");
const studyRoutes = require("./routes/study.routes");

const app = express();

// 1. Security Headers via Helmet
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// 2. Correlation ID for distributed request tracing
app.use(requestIdMiddleware);

// 3. Prometheus Request Duration Metrics
app.use(metricsMiddleware);

// 4. Structured HTTP Logging
if (process.env.NODE_ENV !== "test") {
  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.id,
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  }));
}

// 5. Body Parsing with safe limits
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// 6. NoSQL Injection Sanitization
app.use(mongoSanitize());

// 7. Controlled CORS
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
      return callback(null, true);
    }
    return callback(null, origin);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-request-id"],
  credentials: true,
}));

// 8. General rate limiting for all endpoints
app.use(rateLimitMiddleware(generalLimiter, (req) => req.ip));

// Root health banner
app.get("/", (req, res) => {
  res.json({
    service: "Jobly API Platform",
    status: "operational",
    version: "2.0.0",
    docs: "/api/health",
  });
});

// Mount Routes
app.use("/api", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/resume", resumeRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/interviews", interviewRoutes);
app.use("/api/interviews/:sessionId/notes", interviewNoteRoutes);
app.use("/api/coding", codingRoutes);
app.use("/api/whiteboard", whiteboardRoutes);
app.use("/api/timeline", timelineRoutes);
app.use("/api/evaluations", evaluationRoutes);
app.use("/api/replay", replayRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/ats", atsRoutes);
app.use("/api/signals", signalsRoutes);
app.use("/api/integrity", integrityRoutes);
app.use("/api/learn", learnRoutes);
app.use("/api/compete", competitionRoutes);
app.use("/api/study", studyRoutes);

// Static uploads serving (Video recordings, resumes, assets)
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error({ err: err.message, stack: err.stack, reqId: req.id }, "Unhandled application error");

  if (err.name === "MulterError") {
    return res.status(400).json({ msg: `Upload error: ${err.message}` });
  }
  if (err.message === "Only PDF allowed") {
    return res.status(400).json({ msg: "Only PDF files are accepted" });
  }

  const isProduction = process.env.NODE_ENV === "production";
  res.status(err.status || 500).json({
    msg: isProduction ? "Internal server error" : err.message || "Internal server error",
    reqId: req.id,
  });
});

module.exports = app;
