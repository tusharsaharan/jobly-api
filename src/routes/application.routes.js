const express = require("express");
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const {
  applyToJob,
  getMyApplications,
  getApplicantsForRecruiter,
  updateApplicationStatus,
} = require("../controllers/application.controller");

const router = express.Router();

router.post("/:jobId", auth, role("seeker"), applyToJob);
router.get("/me", auth, role("seeker"), getMyApplications);
router.get("/recruiter", auth, role("recruiter"), getApplicantsForRecruiter);
router.patch(
  "/:applicationId/status",
  auth,
  role("recruiter"),
  updateApplicationStatus
);

module.exports = router;

