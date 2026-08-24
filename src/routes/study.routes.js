const express = require("express");
const router = express.Router();
const studyController = require("../controllers/study.controller");
const authMiddleware = require("../middleware/auth.middleware");

// Public endpoints with optional personalization
router.get("/problems", authMiddleware.optional, studyController.getProblems);
router.get("/problems/stats", authMiddleware.optional, studyController.getProblemStats);
router.get("/system-design", authMiddleware.optional, studyController.getSystemDesignTopics);
router.get("/lld-problems", authMiddleware.optional, studyController.getLldProblems);
router.get("/hld-problems", authMiddleware.optional, studyController.getHldProblems);
router.get("/search", authMiddleware.optional, studyController.searchResources);
router.post("/chat", authMiddleware.optional, studyController.ragChatbot);
router.post("/tutor", authMiddleware.optional, studyController.generalTutor);
router.get("/codeforces/:handle", authMiddleware.optional, studyController.getCodeforcesStats);
router.get("/repo", authMiddleware.optional, studyController.getRepoData);

// Authenticated Candidate Endpoints
router.get("/progress", authMiddleware, studyController.getProgress);
router.post("/progress", authMiddleware, studyController.markProgress);
router.get("/weaknesses", authMiddleware, studyController.getWeaknesses);
router.post("/weaknesses/:id/resolve", authMiddleware, studyController.resolveWeakness);
router.get("/interview-topics", authMiddleware, studyController.getInterviewTopics);

module.exports = router;
