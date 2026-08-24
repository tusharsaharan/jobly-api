const express = require("express");
const router = express.Router();
const signalsController = require("../controllers/signals.controller");
const authMiddleware = require("../middleware/auth.middleware");

router.use(authMiddleware);

router.post("/extract", signalsController.extractSignals);
router.get("/session/:sessionId", signalsController.getSignalsBySession);
router.post("/evaluate/:sessionId", signalsController.evaluateSessionSignals);
router.post("/resolve-evidence", signalsController.resolveEvidence);

module.exports = router;
