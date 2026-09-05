const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const whiteboardController = require("../controllers/whiteboard.controller");

router.use(authMiddleware);

router.get("/:sessionId/snapshots", whiteboardController.listSnapshots);
router.post("/:sessionId/snapshots", whiteboardController.createSnapshot);
router.post("/:sessionId/snapshots/:snapshotId/restore", whiteboardController.restoreSnapshot);

module.exports = router;
