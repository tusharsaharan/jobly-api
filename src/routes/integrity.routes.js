const express = require("express");
const router = express.Router();
const integrityController = require("../controllers/integrity.controller");
const authMiddleware = require("../middleware/auth.middleware");

router.use(authMiddleware);

router.post("/telemetry", integrityController.ingestTelemetry);
router.post("/similarity-check", integrityController.checkSimilarity);
router.get("/session/:sessionId/report", integrityController.getSessionReport);

module.exports = router;
