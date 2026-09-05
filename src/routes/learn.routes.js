const express = require("express");
const router = express.Router();
const learnController = require("../controllers/learn.controller");
const authMiddleware = require("../middleware/auth.middleware");
router.use(authMiddleware);
router.post("/generate-quiz", learnController.generateQuiz);
router.post("/session", learnController.startSession);
router.post("/session/:id/fail", learnController.failSession);
router.post("/session/:id/complete", learnController.completeSession);
router.get("/stats", learnController.getGamificationStats);

module.exports = router;
