const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const {
  createJob,
  getJobs,
  getMatchedJobs,
  getJobAtsScore,
  generateJob
} = require("../controllers/job.controller");

router.post("/", auth, role("recruiter"), createJob);
router.post("/ai-generate", auth, role("recruiter"), generateJob);
router.get("/", auth, getJobs);
router.get("/match", auth, role("seeker"), getMatchedJobs);
router.get("/:jobId/ats-score", auth, getJobAtsScore);

module.exports = router;
