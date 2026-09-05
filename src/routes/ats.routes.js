const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const { getApplicationAnalysis, calculateJobFit } = require("../controllers/ats.controller");

router.get("/applications/:applicationId/analysis", auth, getApplicationAnalysis);
router.post("/jobs/:jobId/calculate", auth, calculateJobFit);

module.exports = router;
