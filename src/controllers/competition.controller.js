const CompetitionLobby = require("../models/CompetitionLobby");
const FocusSession = require("../models/FocusSession");
const aiService = require("../services/ai.service");
const logger = require("../config/logger");

function generatePin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

exports.createLobby = async (req, res) => {
  try {
    const { topic, mode, difficulty = "Mixed", questionCount = 5, timeLimitSeconds = 20 } = req.body;
    if (!topic || !mode) return res.status(400).json({ error: "Topic and mode are required" });
    const cleanTopic = String(topic).trim().slice(0, 200);
    if (cleanTopic.length < 2) return res.status(400).json({ error: "Topic must be at least 2 characters" });
    const validModes = ["QUIZ", "CP"];
    if (!validModes.includes(String(mode))) return res.status(400).json({ error: "Invalid mode" });
    let parsedCount = parseInt(questionCount, 10);
    if (Number.isNaN(parsedCount) || parsedCount < 3) parsedCount = 5;
    if (parsedCount > 20) parsedCount = 20;
    let parsedTimeLimit = parseInt(timeLimitSeconds, 10);
    if (Number.isNaN(parsedTimeLimit) || parsedTimeLimit < 5) parsedTimeLimit = 20;
    if (parsedTimeLimit > 60) parsedTimeLimit = 60;
    const validDifficulties = ["Easy", "Medium", "Hard", "Mixed"];
    const cleanDifficulty = validDifficulties.includes(String(difficulty)) ? String(difficulty) : "Mixed";

    let pin;
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 5) {
      pin = generatePin();
      const existing = await CompetitionLobby.findOne({ pin });
      if (!existing) isUnique = true;
      attempts++;
    }
    if (!isUnique) pin = generatePin();

    let quizData = [];
    let cpData = null;

    if (mode === "QUIZ") {
      // Fetch recent quiz questions for this user to avoid duplicates
      const hostId = req.user._id || req.user.id;
      const recentSessions = await FocusSession.find({ 
        user: hostId, 
        type: "QUIZ", 
        status: "COMPLETED" 
      })
        .sort({ createdAt: -1 })
        .limit(3)
        .lean();
      
      const recentQuestions = recentSessions.flatMap(s => 
        (s.quizData || []).map(q => q.question)
      ).slice(0, 10);

      quizData = await aiService.generateFocusQuiz(cleanTopic, null, {
        difficulty: cleanDifficulty,
        count: parsedCount,
        recentQuestions
      });
      if (parsedTimeLimit) {
        quizData = quizData.map(q => ({ ...q, timeLimitSeconds: parsedTimeLimit }));
      }
    } else if (mode === "CP") {
      cpData = await aiService.generateCPProblem(cleanTopic, { difficulty: cleanDifficulty });
    }

    const hostId = req.user._id || req.user.id;
    try {
      const lobby = await CompetitionLobby.create({
        pin,
        hostId,
        topic: cleanTopic,
        mode,
        difficulty: cleanDifficulty,
        questionCount: parsedCount,
        quizData: mode === "QUIZ" ? quizData : undefined,
        cpData: mode === "CP" ? cpData : undefined,
        players: [{
          userId: hostId,
          name: req.user.name,
          isHost: true
        }]
      });
      return res.status(201).json({ lobby });
    } catch (createErr) {
      if (createErr.code === 11000) {
        // PIN collision race, retry once with new PIN
        const retryPin = generatePin();
        const lobby = await CompetitionLobby.create({
          pin: retryPin,
          hostId,
          topic: cleanTopic,
          mode,
          difficulty: cleanDifficulty,
          questionCount: parsedCount,
          quizData: mode === "QUIZ" ? quizData : undefined,
          cpData: mode === "CP" ? cpData : undefined,
          players: [{
            userId: hostId,
            name: req.user.name,
            isHost: true
          }]
        });
        return res.status(201).json({ lobby });
      }
      throw createErr;
    }
  } catch (error) {
    logger.error("Error creating competition lobby", error);
    if (error.name === "ValidationError") return res.status(400).json({ error: error.message });
    res.status(500).json({ error: "Failed to create lobby" });
  }
};

exports.joinLobby = async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || typeof pin !== "string") return res.status(400).json({ error: "PIN is required" });
    const cleanPin = String(pin).trim();
    if (!/^\d{6}$/.test(cleanPin)) return res.status(400).json({ error: "Invalid PIN format" });

    const userId = req.user._id || req.user.id;
    // Atomic join to prevent duplicate players under concurrent recruiter joins
    const lobby = await CompetitionLobby.findOne({ pin: cleanPin });
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });

    if (lobby.status !== "WAITING") {
      return res.status(400).json({ error: "Competition has already started" });
    }

    const alreadyJoined = lobby.players.find(p => String(p.userId) === String(userId));
    
    if (!alreadyJoined) {
      const updated = await CompetitionLobby.findOneAndUpdate(
        { pin: cleanPin, "players.userId": { $ne: userId }, status: "WAITING" },
        { $push: { players: { userId, name: req.user.name, isHost: false } } },
        { new: true }
      );
      if (updated) return res.json({ lobby: updated });
      // If not updated, someone else joined concurrently or already joined
      const refreshed = await CompetitionLobby.findOne({ pin: cleanPin });
      return res.json({ lobby: refreshed });
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
    if (!id || !String(id).match(/^[0-9a-fA-F]{24}$/)) return res.status(400).json({ error: "Invalid lobby ID format" });
    const lobby = await CompetitionLobby.findById(id);
    if (!lobby) return res.status(404).json({ error: "Lobby not found" });
    // Membership check — don't leak quiz answers / cp test cases to non-members
    const uid = String(req.user?._id || req.user?.id);
    const isMember = (lobby.players || []).some((p) => String(p.userId) === uid) || String(lobby.hostId) === uid;
    if (!isMember) return res.status(403).json({ error: "Access denied. Not a lobby member." });

    res.json({ lobby });
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ error: "Invalid lobby ID format" });
    logger.error("Error fetching lobby", error);
    res.status(500).json({ error: "Failed to fetch lobby" });
  }
};
