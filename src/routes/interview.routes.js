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

// Static routes (must precede /:sessionId parameter routes)
router.get("/room/:roomKey", interviewController.getInterviewByRoomKey);
router.post("/config/parse", interviewController.parseConfig);
router.post("/config/format", interviewController.formatConfig);
router.get("/invites/validate/:token", interviewController.validateInterviewInvite);
router.post("/invites/accept/:token", interviewController.acceptInterviewInvite);

// Parameterized interview session endpoints
router.get("/:sessionId", interviewController.getInterviewSession);
router.post("/:sessionId/invites", roleMiddleware("recruiter"), interviewController.createInterviewInvite);

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
router.put(
  "/:sessionId/stage",
  roleMiddleware("recruiter"),
  validateBody(updateStageSchema),
  interviewController.updateInterviewStage
);

// Transition interview status (Recruiter only)
router.patch("/:sessionId/status", roleMiddleware("recruiter"), interviewController.updateInterviewStatus);
router.put("/:sessionId/status", roleMiddleware("recruiter"), interviewController.updateInterviewStatus);

// WebRTC LiveKit signed access token
router.post("/:sessionId/livekit-token", interviewController.getLiveKitToken);

// Video / Audio recording storage
const videoUpload = require("../middleware/videoUpload.middleware");
router.post("/:sessionId/recording", videoUpload.single("video"), interviewController.uploadInterviewRecording);
router.get("/:sessionId/recording", interviewController.getInterviewRecording);

module.exports = router;

