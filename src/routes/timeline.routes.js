const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const timelineController = require("../controllers/timeline.controller");

router.use(authMiddleware);

router.get("/:sessionId/events", timelineController.getTimelineEvents);
router.get("/:sessionId/events/:eventId", timelineController.getTimelineEventById);
router.get("/:sessionId/events/:eventId/context", timelineController.getTimelineEventContext);
router.get("/:sessionId/search", timelineController.searchTimeline);

module.exports = router;
