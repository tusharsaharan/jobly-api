const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware");
const interviewController = require("../controllers/interview.controller");
const {
  validateBody,
  scheduleInterviewSchema,
  updateStageSchema,
  executeCodeSchema,
} = require("../middleware/validation.middleware");

// All interview endpoints require valid authentication
router.use(authMiddleware);

// Schedule a new interview session (Recruiter only)
router.post(
  "/schedule",
  roleMiddleware("recruiter"),
  validateBody(scheduleInterviewSchema),
  interviewController.scheduleInterview
);

// List all interview sessions for current user (Seeker sees theirs, Recruiter sees theirs)
router.get("/", interviewController.getMyInterviews);

// Get specific interview session details and timeline
router.get("/:sessionId", interviewController.getInterviewSession);

// Get session details and room token by room key
router.get("/room/:roomKey", interviewController.getInterviewByRoomKey);

// Execute candidate code in sandbox
router.post(
  "/:sessionId/execute",
  validateBody(executeCodeSchema),
  interviewController.executeCodeInSession
);

// AI Co-Interviewer real-time suggestion (Recruiter only)
router.post("/:sessionId/ai-suggest", roleMiddleware("recruiter"), interviewController.getAiSuggestion);

// Finalize and save post-interview evaluation & scorecard (Recruiter only)
router.post("/:sessionId/evaluate", roleMiddleware("recruiter"), interviewController.evaluateInterview);

// Transition interview stage (Recruiter only)
router.patch(
  "/:sessionId/stage",
  roleMiddleware("recruiter"),
  validateBody(updateStageSchema),
  interviewController.updateInterviewStage
);

// WebRTC LiveKit signed access token
router.post("/:sessionId/livekit-token", interviewController.getLiveKitToken);

// Config DSL parsing & pretty-printing
router.post("/config/parse", interviewController.parseConfig);
router.post("/config/format", interviewController.formatConfig);

module.exports = router;
