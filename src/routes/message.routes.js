const express = require("express");
const auth = require("../middleware/auth.middleware");
const {
  getApplicationMessages,
  sendApplicationMessage,
} = require("../controllers/message.controller");

const router = express.Router();

router.get("/application/:applicationId", auth, getApplicationMessages);
router.post("/application/:applicationId", auth, sendApplicationMessage);

module.exports = router;
