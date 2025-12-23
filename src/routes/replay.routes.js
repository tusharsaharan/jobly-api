const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const replayController = require("../controllers/replay.controller");

router.use(authMiddleware);

router.get("/:sessionId/manifest", replayController.getReplayManifest);
router.get("/:sessionId/frame", replayController.getReplayFrame);

module.exports = router;
