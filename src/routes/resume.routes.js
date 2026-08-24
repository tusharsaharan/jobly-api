const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const upload = require("../middleware/upload.middleware");
const {
  uploadResume,
  streamResumeEvents,
  getJobStatus,
  getUploadStatus,
  getResumeProfile,
  updateResumeProfile,
} = require("../controllers/resume.controller");
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
router.get("/upload/:uploadId/status", auth, getUploadStatus);
router.get("/profile", auth, getResumeProfile);
router.put("/profile", auth, role("seeker"), updateResumeProfile);

module.exports = router;
