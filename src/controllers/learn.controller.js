const FocusSession = require("../models/FocusSession");
const User = require("../models/User");
const aiService = require("../services/ai.service");
const logger = require("../config/logger");
const { TOPIC_TAXONOMY, matchTopicsFromText, getTopicNames } = require("../constants/topicTaxonomy");

exports.generateQuiz = async (req, res) => {
  try {
    const { topic, difficulty = "Medium", count = 5 } = req.body;
    if (!topic || typeof topic !== "string" || !topic.trim()) return res.status(400).json({ error: "Topic is required" });
    const cleanTopic = String(topic).trim().slice(0, 200);
    if (cleanTopic.length < 2) return res.status(400).json({ error: "Topic must be at least 2 characters" });
    // Topic gate is OPEN to any domain (CS, polity, culinary, any profession).
    // Gemini generates domain-correct questions for whatever the user asks;
    // we only reject strings that cannot be a topic at all (pure symbols/digits).
    if (!/[a-z\u00C0-\u024F\u0900-\u097F\u4E00-\u9FFF]/i.test(cleanTopic)) {
      return res.status(400).json({
        error: "Topic must contain at least some letters.",
        suggestions: getTopicNames().slice(0, 10),
      });
    }
    let parsedCount = parseInt(count, 10);
    if (Number.isNaN(parsedCount) || parsedCount < 1) parsedCount = 5;
    if (parsedCount > 20) parsedCount = 20;

    const validDifficulties = ["Easy", "Medium", "Hard", "Mixed"];
    const cleanDifficulty = validDifficulties.includes(String(difficulty)) ? String(difficulty) : "Medium";

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("-password");
    const userProfile = user ? { skills: user.skills, experience: user.experience } : null;
    
    // Fetch recent quiz questions to avoid duplicates
    const recentSessions = await FocusSession.find({ 
      user: userId, 
      type: "QUIZ", 
      status: "COMPLETED" 
    })
      .sort({ createdAt: -1 })
      .limit(3)
      .lean();
    
    const recentQuestions = recentSessions.flatMap(s => 
      (s.quizData || []).map(q => q.question)
    ).slice(0, 10);
    
    const quizData = await aiService.generateFocusQuiz(cleanTopic, userProfile, {
      difficulty: cleanDifficulty,
      count: parsedCount,
      recentQuestions
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
    const validTypes = ["STUDY", "QUIZ"];
    if (!validTypes.includes(String(type))) {
      return res.status(400).json({ error: "Invalid type. Must be STUDY or QUIZ" });
    }
    const cleanTopic = String(topic).trim().slice(0, 200);
    if (cleanTopic.length < 2) return res.status(400).json({ error: "Topic must be at least 2 characters" });
    let parsedDuration = parseInt(durationMinutes, 10);
    if (Number.isNaN(parsedDuration) || parsedDuration < 1) return res.status(400).json({ error: "durationMinutes must be a positive number" });
    if (parsedDuration > 240) parsedDuration = 240;

    const userId = req.user._id || req.user.id;

    // QUIZ sessions: the server ALWAYS generates the quiz from the topic.
    // Client-supplied quizData is ignored (trust boundary — a client that
    // authors its own quiz+answers could otherwise self-award points).
    let serverQuizData = null;
    if (String(type) === "QUIZ") {
      try {
        const count = Array.isArray(quizData) ? Math.min(quizData.length, 20) : 5;
        serverQuizData = await aiService.generateFocusQuiz(cleanTopic, null, {
          difficulty: "Mixed",
          count: Math.max(3, count),
        });
      } catch (err) {
        logger.warn({ err: err.message, topic: cleanTopic }, "Server quiz generation failed");
        return res.status(503).json({ error: "Quiz generation is temporarily unavailable. Try again." });
      }
    }

    const session = await FocusSession.create({
      user: userId,
      type: String(type),
      topic: cleanTopic,
      durationMinutes: parsedDuration,
      quizData: serverQuizData,
      status: "ACTIVE"
    });

    // Never echo correctAnswer to the client on session start.
    const safeQuiz = (serverQuizData || []).map((q) => {
      const { correctAnswer, ...rest } = q || {};
      return rest;
    });
    res.status(201).json({ ...session.toObject(), quizData: safeQuiz });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: error.message });
    }
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
    const { score, answers } = req.body; // answers: Record<index, chosenOption> or array
    const userId = req.user._id || req.user.id;
    
    const session = await FocusSession.findOne({ _id: id, user: userId });
    if (!session) return res.status(404).json({ error: "Session not found" });
    
    if (session.status !== "ACTIVE") {
      return res.status(400).json({ error: "Session is not active" });
    }

    session.status = "COMPLETED";
    session.completed = true;
    session.endTime = new Date();

    // ── QUIZ scoring: server-verified when answers provided ──
    // Server-verified scoring ONLY. A QUIZ session is scored against the
    // server-generated quizData stored at startSession — a client score is
    // never trusted for points (gamification cheat vector).
    let verifiedScore = null;
    if (session.type === "QUIZ") {
      if (!session.quizData || !Array.isArray(session.quizData) || session.quizData.length === 0) {
        return res.status(400).json({ error: "This quiz session has no server-generated questions to score." });
      }
      if (answers === undefined || answers === null) {
        return res.status(400).json({ error: "Answers are required to complete a quiz session" });
      }
      const ansMap = Array.isArray(answers) ? answers : answers;
      let correct = 0;
      const total = session.quizData.length;
      session.quizData.forEach((q, idx) => {
        const chosen = Array.isArray(answers) ? answers[idx] : ansMap[String(idx)] ?? ansMap[idx];
        if (chosen !== undefined && chosen !== null && Number(chosen) === Number(q.correctAnswer)) correct++;
      });
      verifiedScore = total > 0 ? Math.round((correct / total) * 100) : 0;
      session.score = verifiedScore;
      session.submittedAnswers = ansMap; // audit trail
    }
    await session.save();

    // ── Auto-resolve weakness if quiz on same topic scored >= 70 ──
    let autoResolvedCount = 0;
    if (session.type === "QUIZ" && verifiedScore !== null && verifiedScore >= 70 && session.topic) {
      try {
        const CandidateTopicWeakness = require("../models/CandidateTopicWeakness");
        const res2 = await CandidateTopicWeakness.updateMany(
          { candidate: userId, topic: session.topic, resolved: false },
          { $set: { resolved: true, resolvedAt: new Date(), resolvedVia: "quiz", resolvedScore: verifiedScore } }
        );
        autoResolvedCount = res2.modifiedCount || 0;
        if (autoResolvedCount > 0) logger.info({ userId, topic: session.topic, score: verifiedScore, autoResolvedCount }, "Auto-resolved weaknesses via quiz mastery");
      } catch (e) {
        logger.warn({ err: e.message }, "Auto-resolve weakness failed");
      }
    }

    // Gamification Points — atomic increments (no lost updates under concurrency)
    const effectiveScore = verifiedScore !== null ? verifiedScore : 0;
    const pointsAwarded = session.type === "QUIZ" ? effectiveScore : session.durationMinutes;

    const user = await User.findById(userId).select("lastFocusDate currentStreak");
    const now = new Date();
    const lastDate = user?.lastFocusDate;
    let streakDelta = 0;
    if (lastDate) {
      const diffHours = (now - lastDate) / (1000 * 60 * 60);
      if (diffHours < 48 && diffHours > 4) streakDelta = 1;
      else if (diffHours >= 48) streakDelta = -(user.currentStreak || 0) + 1;
    } else {
      streakDelta = 1;
    }

    await User.findByIdAndUpdate(
      userId,
      {
        $inc: { focusPoints: pointsAwarded, currentStreak: streakDelta },
        $set: { lastFocusDate: now },
      },
      { new: true }
    );
    const updatedUser = await User.findById(userId).select("-password");

    res.json({ success: true, pointsAwarded, newTotal: updatedUser?.focusPoints || 0, newStreak: updatedUser?.currentStreak || 0, autoResolvedCount, verifiedScore, session });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: error.message });
    }
    logger.error("Error completing session", error);
    res.status(500).json({ error: "Failed to complete session" });
  }
};

exports.getGamificationStats = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("-password");
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
