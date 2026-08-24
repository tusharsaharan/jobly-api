const express = require("express");
const auth = require("../middleware/auth.middleware");
const {
  getUserConversations,
  getApplicationMessages,
  sendApplicationMessage,
  markApplicationMessagesRead,
  getApplicationSmartReplies,
} = require("../controllers/message.controller");

const router = express.Router();

router.get("/conversations", auth, getUserConversations);
router.get("/application/:applicationId", auth, getApplicationMessages);
router.get("/application/:applicationId/smart-replies", auth, getApplicationSmartReplies);
router.post("/application/:applicationId", auth, sendApplicationMessage);
router.patch("/application/:applicationId/read", auth, markApplicationMessagesRead);

module.exports = router;
