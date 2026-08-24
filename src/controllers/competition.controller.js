const CompetitionLobby = require("../models/CompetitionLobby");
const aiService = require("../services/ai.service");
const logger = require("../config/logger");

function generatePin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

exports.createLobby = async (req, res) => {
  try {
    const { topic, mode, difficulty = "Mixed", questionCount = 5, timeLimitSeconds = 20 } = req.body;
    if (!topic || !mode) return res.status(400).json({ error: "Topic and mode are required" });

    let pin;
    let isUnique = false;
    while (!isUnique) {
      pin = generatePin();
      const existing = await CompetitionLobby.findOne({ pin });
      if (!existing) isUnique = true;
    }

    let quizData = [];
    let cpData = null;

    if (mode === "QUIZ") {
      quizData = await aiService.generateFocusQuiz(topic, null, {
        difficulty,
        count: Number(questionCount) || 5
      });
      if (Number(timeLimitSeconds)) {
        quizData = quizData.map(q => ({ ...q, timeLimitSeconds: Number(timeLimitSeconds) }));
      }
    } else if (mode === "CP") {
      cpData = await aiService.generateCPProblem(topic, { difficulty });
    }

    const lobby = await CompetitionLobby.create({
      pin,
      hostId: req.user.id,
      topic,
      mode,
      difficulty,
      questionCount: Number(questionCount) || 5,
      quizData: mode === "QUIZ" ? quizData : undefined,
      cpData: mode === "CP" ? cpData : undefined,
      players: [{
        userId: req.user.id,
        name: req.user.name,
        isHost: true
      }]
    });

    res.status(201).json({ lobby });
  } catch (error) {
    logger.error("Error creating competition lobby", error);
    res.status(500).json({ error: "Failed to create lobby" });
  }
};

exports.joinLobby = async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: "PIN is required" });

    const lobby = await CompetitionLobby.findOne({ pin });
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });

    if (lobby.status !== "WAITING") {
      return res.status(400).json({ error: "Competition has already started" });
    }

    const alreadyJoined = lobby.players.find(p => String(p.userId) === String(req.user.id));
    
    if (!alreadyJoined) {
      lobby.players.push({
        userId: req.user.id,
        name: req.user.name,
        isHost: false
      });
      await lobby.save();
    }

    res.json({ lobby });
  } catch (error) {
    logger.error("Error joining lobby", error);
    res.status(500).json({ error: "Failed to join lobby" });
  }
};

exports.getLobby = async (req, res) => {
  try {
    const { id } = req.params;
    const lobby = await CompetitionLobby.findById(id);
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });

    res.json({ lobby });
  } catch (error) {
    logger.error("Error fetching lobby", error);
    res.status(500).json({ error: "Failed to fetch lobby" });
  }
};
