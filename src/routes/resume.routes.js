const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const upload = require("../middleware/upload.middleware");
const { uploadResume, streamResumeEvents, getJobStatus } = require("../controllers/resume.controller");
const { rateLimitMiddleware, resumeLimiter } = require("../middleware/rateLimiter.middleware");

router.post(
  "/upload",
  auth,
  role("seeker"),
  rateLimitMiddleware(resumeLimiter),
  upload.single("resume"),
  uploadResume
);

router.get("/events", auth, streamResumeEvents);
router.get("/status/:jobId", auth, getJobStatus);

module.exports = router;
