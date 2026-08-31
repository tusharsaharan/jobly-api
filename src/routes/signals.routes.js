const express = require("express");
const router = express.Router();
const signalsController = require("../controllers/signals.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { rateLimitMiddleware, signalsExtractLimiter, signalsSessionLimiter } = require("../middleware/rateLimiter.middleware");

router.use(authMiddleware);

// Canonical plan routes
// B12: express rate limit for POST /api/signals/extract per IP per session (100 signals/session)
router.post(
  "/extract",
  rateLimitMiddleware(signalsExtractLimiter, (req) => `${req.ip}:${String(req.body?.sessionId || "nosession")}`),
  signalsController.extractSignals
);
router.get("/session/:sessionId", rateLimitMiddleware(signalsSessionLimiter, (req) => `${req.ip}:${req.params.sessionId}`), signalsController.getSignalsBySession);
// Plan alias: POST /api/evaluations/:sessionId/competencies is in evaluation.routes, but also expose via signals for gateway parity
router.post("/evaluate/:sessionId", rateLimitMiddleware(signalsExtractLimiter, (req) => `${req.ip}:${req.params.sessionId}`), signalsController.evaluateSessionSignals);
router.post("/resolve-evidence", rateLimitMiddleware(signalsSessionLimiter, (req) => req.ip), signalsController.resolveEvidence);
// Strict plan compliance: evidence resolution via GET param (mirrors evaluation route)
router.get("/evidence/:evidenceId", signalsController.resolveEvidenceById);
router.post("/evidence/:evidenceId/resolve", signalsController.resolveEvidence);

module.exports = router;
