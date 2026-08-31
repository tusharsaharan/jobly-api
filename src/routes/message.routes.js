const express = require("express");
const auth = require("../middleware/auth.middleware");
const {
  getUserConversations,
  getApplicationMessages,
  sendApplicationMessage,
  markApplicationMessagesRead,
  getApplicationSmartReplies,
  summarizeApplicationConversation,
} = require("../controllers/message.controller");

const { rateLimitMiddleware, generalLimiter } = require("../middleware/rateLimiter.middleware");
const messageLimiter = generalLimiter;
const router = express.Router();

router.get("/conversations", auth, getUserConversations);
router.get("/application/:applicationId", auth, getApplicationMessages);
router.get("/application/:applicationId/summary", auth, summarizeApplicationConversation);
router.get("/application/:applicationId/smart-replies", auth, getApplicationSmartReplies);
router.post("/application/:applicationId", auth, rateLimitMiddleware(messageLimiter, (req) => `${req.user?._id?.toString()}:${req.params.applicationId}`), sendApplicationMessage);
router.patch("/application/:applicationId/read", auth, markApplicationMessagesRead);

module.exports = router;
