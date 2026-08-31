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
    // Off-topic guard: burger, Hindi, junk etc. — quiz is for CS / System Design only
    const lower = cleanTopic.toLowerCase();
    const isOffTopic = (() => {
      // If it matches taxonomy, it's always valid
      if (TOPIC_TAXONOMY[cleanTopic]) return false;
      if (matchTopicsFromText(cleanTopic).length > 0) return false;
      // Allow if it contains obvious CS keywords even if not in taxonomy (e.g. "binary search", "kafka")
      const csHints = ["array","string","tree","graph","dp","dynamic","recursion","sort","search","hash","heap","stack","queue","linked","bit","trie","segment","os","operating","dbms","database","sql","network","tcp","udp","http","dns","oop","solid","design pattern","load balancing","caching","shard","queue","kafka","microservice","cap","consistency","availability","rate limit","consistent hash","message","system design","lld","hld","java","python","c++","javascript","interview","algorithm","data structure"];
      if (csHints.some(h => lower.includes(h))) return false;
      // Check for pure non-CS junk: Hindi, food, single random word with no CS hint
      const offHints = ["burger","pasta","recipe","cricket","food","cook","tujhe","kuch","nhi","aata","yeh","kya","hai","samjhao"];
      if (offHints.some(h => lower.includes(h))) return true;
      // Very short or pure symbols/numbers: let it pass to AI but will be caught by RAG later; for quiz, be strict if no taxonomy hit and no CS hint
      if (cleanTopic.split(/\s+/).length <= 2 && !csHints.some(h => lower.includes(h))) {
        // Check if it's at least 3 chars and looks like a CS topic (heuristic)
        const hasCsChar = /[a-z]{3,}/.test(lower);
        if (!hasCsChar) return true;
        // If no taxonomy and no CS hint, treat as off-topic
        return true;
      }
      return false;
    })();
    if (isOffTopic) {
      return res.status(400).json({
        error: `Topic "${cleanTopic}" is outside the study catalog. Please choose a CS / System Design topic.`,
        suggestions: getTopicNames().slice(0, 10),
        hint: "Try: Arrays, Dynamic Programming, Operating Systems, DBMS, System Design Case Studies, etc."
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
    const session = await FocusSession.create({
      user: userId,
      type: String(type),
      topic: cleanTopic,
      durationMinutes: parsedDuration,
      quizData: String(type) === "QUIZ" ? quizData : null,
      status: "ACTIVE"
    });

    res.status(201).json(session);
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
    // If client sent `answers`, recompute score from stored quizData (trust boundary).
    // Otherwise fall back to client `score` for backwards compat (legacy callers).
    let verifiedScore = null;
    if (session.type === "QUIZ") {
      if (answers !== undefined && session.quizData && Array.isArray(session.quizData) && session.quizData.length > 0) {
        const ansMap = Array.isArray(answers) ? answers : answers;
        let correct = 0;
        let total = session.quizData.length;
        session.quizData.forEach((q, idx) => {
          const chosen = Array.isArray(answers) ? answers[idx] : ansMap[String(idx)] ?? ansMap[idx];
          if (chosen !== undefined && chosen !== null && Number(chosen) === Number(q.correctAnswer)) correct++;
        });
        verifiedScore = total > 0 ? Math.round((correct / total) * 100) : 0;
        session.score = verifiedScore;
        session.submittedAnswers = ansMap; // audit trail
      } else if (score !== undefined) {
        const parsedScore = Number(score);
        if (Number.isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100) {
          return res.status(400).json({ error: "Score must be between 0 and 100" });
        }
        // Cap client-submitted score — still store but flag as unverified
        session.score = parsedScore;
        verifiedScore = parsedScore;
      }
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

    // Gamification Points — use verified score if available
    const effectiveScore = verifiedScore !== null ? verifiedScore : (score || 0);
    const pointsAwarded = session.type === "QUIZ" ? effectiveScore : session.durationMinutes;
    
    const user = await User.findById(userId).select("-password");
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

    res.json({ success: true, pointsAwarded, newTotal: user?.focusPoints || 0, newStreak: user?.currentStreak || 0, autoResolvedCount, verifiedScore, session });
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
