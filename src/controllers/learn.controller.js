const FocusSession = require("../models/FocusSession");
const User = require("../models/User");
const aiService = require("../services/ai.service");
const logger = require("../config/logger");

exports.generateQuiz = async (req, res) => {
  try {
    const { topic, difficulty = "Medium", count = 5 } = req.body;
    if (!topic) return res.status(400).json({ error: "Topic is required" });

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    const userProfile = user ? { skills: user.skills, experience: user.experience } : null;
    
    const quizData = await aiService.generateFocusQuiz(topic, userProfile, {
      difficulty,
      count: Number(count) || 5
    });
    res.json({ quiz: quizData });
  } catch (error) {
    logger.error("Error generating quiz", error);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
};

exports.startSession = async (req, res) => {
  try {
    const { type, topic, durationMinutes, quizData } = req.body;
    
    if (!type || !topic || !durationMinutes) {
      return res.status(400).json({ error: "type, topic, and durationMinutes are required" });
    }

    const userId = req.user._id || req.user.id;
    const session = await FocusSession.create({
      user: userId,
      type,
      topic,
      durationMinutes,
      quizData: type === "QUIZ" ? quizData : null,
      status: "ACTIVE"
    });

    res.status(201).json(session);
  } catch (error) {
    logger.error("Error starting focus session", error);
    res.status(500).json({ error: "Failed to start focus session" });
  }
};

exports.failSession = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id || req.user.id;
    const session = await FocusSession.findOne({ _id: id, user: userId });

    if (!session) return res.status(404).json({ error: "Session not found" });

    session.strikes += 1;
    session.status = "FAILED";
    session.endTime = new Date();
    await session.save();

    // Reset user streak if they fail
    await User.findByIdAndUpdate(userId, { currentStreak: 0 });

    res.json({ success: true, session });
  } catch (error) {
    logger.error("Error failing session", error);
    res.status(500).json({ error: "Failed to update session" });
  }
};

exports.completeSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { score } = req.body; // For QUIZ
    const userId = req.user._id || req.user.id;
    
    const session = await FocusSession.findOne({ _id: id, user: userId });
    if (!session) return res.status(404).json({ error: "Session not found" });
    
    if (session.status !== "ACTIVE") {
      return res.status(400).json({ error: "Session is not active" });
    }

    session.status = "COMPLETED";
    session.completed = true;
    session.endTime = new Date();
    if (session.type === "QUIZ" && score !== undefined) {
      session.score = score;
    }
    await session.save();

    // Gamification Points
    const pointsAwarded = session.type === "QUIZ" ? (score || 0) : session.durationMinutes;
    
    const user = await User.findById(userId);
    if (user) {
      user.focusPoints = (user.focusPoints || 0) + pointsAwarded;
      
      const now = new Date();
      const lastDate = user.lastFocusDate;
      
      if (lastDate) {
        const diffHours = (now - lastDate) / (1000 * 60 * 60);
        if (diffHours < 48 && diffHours > 4) {
          user.currentStreak = (user.currentStreak || 0) + 1;
        } else if (diffHours >= 48) {
          user.currentStreak = 1;
        }
      } else {
        user.currentStreak = 1;
      }
      
      user.lastFocusDate = now;
      await user.save();
    }

    res.json({ success: true, pointsAwarded, newTotal: user?.focusPoints || 0, newStreak: user?.currentStreak || 0, session });
  } catch (error) {
    logger.error("Error completing session", error);
    res.status(500).json({ error: "Failed to complete session" });
  }
};

exports.getGamificationStats = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    const sessions = await FocusSession.find({ user: userId, status: "COMPLETED" });
    
    // Calculate total study time
    const studySessions = sessions.filter(s => s.type === "STUDY");
    const totalStudyMinutes = studySessions.reduce((acc, cur) => acc + cur.durationMinutes, 0);

    // Calculate quiz average
    const quizSessions = sessions.filter(s => s.type === "QUIZ" && s.score !== undefined);
    const avgScore = quizSessions.length > 0 
      ? Math.round(quizSessions.reduce((acc, cur) => acc + cur.score, 0) / quizSessions.length)
      : 0;

    // Topics Breakdown
    const topicCounts = {};
    sessions.forEach(s => {
      topicCounts[s.topic] = (topicCounts[s.topic] || 0) + 1;
    });

    const radarData = Object.keys(topicCounts).map(topic => ({
      subject: topic,
      A: topicCounts[topic] * 10,
      fullMark: 100
    }));

    res.json({
      focusPoints: user?.focusPoints || 0,
      currentStreak: user?.currentStreak || 0,
      totalStudyMinutes,
      avgScore,
      radarData,
      recentSessions: sessions.slice(-5).reverse()
    });
  } catch (error) {
    logger.error("Error fetching stats", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
};
