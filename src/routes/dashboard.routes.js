const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const dashboardController = require("../controllers/dashboard.controller");

router.use(authMiddleware);

router.get("/stats", dashboardController.getRecruiterStats);
router.get("/interviews", dashboardController.getDashboardInterviews);
router.get("/leaderboard", dashboardController.getRecruiterLeaderboard);

module.exports = router;
