const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const codingController = require("../controllers/coding.controller");

// All collaborative workspace operations require valid user authentication
router.use(authMiddleware);

// Multi-file workspace routes
router.get("/:sessionId/workspace", codingController.getWorkspace);
router.post("/:sessionId/files", codingController.createFile);
router.delete("/:sessionId/files", codingController.deleteFile);
router.put("/:sessionId/files/rename", codingController.renameFile);
router.post("/:sessionId/directories", codingController.createDirectory);

// Interactive terminal routes
router.post("/:sessionId/terminal", codingController.createTerminal);
router.delete("/:sessionId/terminal/:terminalId", codingController.closeTerminal);

// Checkpoint & Time-travel routes
router.get("/:sessionId/checkpoints", codingController.listCheckpoints);
router.post("/:sessionId/checkpoints", codingController.createManualCheckpoint);
router.post("/:sessionId/checkpoints/:checkpointId/restore", codingController.restoreCheckpointHandler);

module.exports = router;
