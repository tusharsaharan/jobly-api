const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const role = require("../middleware/role.middleware");
const {
  createJob,
  getJobs,
  searchJobs,
  getMatchedJobs,
  getJobAtsScore,
  generateJob,
  candidatePoolPreview,
  flagRequirements,
  getHealthScore,
  predictTimeToFill,
  deiRewrite,
  getCoachingStats,
  marketCompare,
  predictQuestions
} = require("../controllers/job.controller");

const blockRoutes = require("./block.routes");

const { rateLimitMiddleware, aiLimiter } = require("../middleware/rateLimiter.middleware");
router.use("/blocks", blockRoutes);
router.post("/", auth, role("recruiter"), createJob);
router.post("/ai-generate", auth, role("recruiter"), rateLimitMiddleware(aiLimiter, (req) => req.user?._id?.toString() || req.ip), generateJob);
router.post("/candidate-pool-preview", auth, role("recruiter"), rateLimitMiddleware(aiLimiter, (req) => req.user?._id?.toString() || req.ip), candidatePoolPreview);
router.post("/flag-requirements", auth, role("recruiter"), rateLimitMiddleware(aiLimiter, (req) => req.user?._id?.toString() || req.ip), flagRequirements);
router.post("/health-score", auth, role("recruiter"), rateLimitMiddleware(aiLimiter, (req) => req.user?._id?.toString() || req.ip), getHealthScore);
router.post("/predict-fill", auth, role("recruiter"), rateLimitMiddleware(aiLimiter, (req) => req.user?._id?.toString() || req.ip), predictTimeToFill);
router.post("/dei-rewrite", auth, role("recruiter"), rateLimitMiddleware(aiLimiter, (req) => req.user?._id?.toString() || req.ip), deiRewrite);
router.post("/market-compare", auth, role("recruiter"), rateLimitMiddleware(aiLimiter, (req) => req.user?._id?.toString() || req.ip), marketCompare);
router.post("/predict-questions", auth, role("recruiter"), rateLimitMiddleware(aiLimiter, (req) => req.user?._id?.toString() || req.ip), predictQuestions);
router.get("/coaching-stats", auth, role("recruiter"), getCoachingStats);
router.get("/search", auth, searchJobs);
router.get("/", auth, getJobs);
router.get("/match", auth, role("seeker"), getMatchedJobs);
router.get("/:jobId/ats-score", auth, getJobAtsScore);

module.exports = router;
