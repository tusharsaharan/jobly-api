const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const replayController = require("../controllers/replay.controller");
const interviewController = require("../controllers/interview.controller");

router.use(authMiddleware);

router.get("/:sessionId/manifest", replayController.getReplayManifest);
router.get("/:sessionId/frame", replayController.getReplayFrame);
router.get("/:sessionId/recording/presigned", interviewController.getRecordingPresignedUrl);

module.exports = router;
