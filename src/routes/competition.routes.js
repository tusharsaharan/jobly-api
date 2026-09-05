const express = require("express");
const router = express.Router();
const competitionController = require("../controllers/competition.controller");
const authMiddleware = require("../middleware/auth.middleware");
router.use(authMiddleware);
router.post("/create", competitionController.createLobby);
router.post("/join", competitionController.joinLobby);
router.get("/:id", competitionController.getLobby);

module.exports = router;
