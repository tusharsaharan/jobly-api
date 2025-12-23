const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const evaluationController = require("../controllers/evaluation.controller");
const { validateBody, createEvaluationSchema } = require("../middleware/validation.middleware");

router.use(authMiddleware);

router.post("/:sessionId", validateBody(createEvaluationSchema), evaluationController.createEvaluation);
router.get("/:sessionId/candidate-feedback", evaluationController.getCandidateFeedback);
router.get("/:sessionId", evaluationController.getEvaluation);
router.put("/:sessionId", evaluationController.updateEvaluation);
router.get("/:sessionId/evidence/:evidenceId", evaluationController.resolveEvidence);

module.exports = router;
