const User = require("../models/User");
const UserProgress = require("../models/UserProgress");
const InterviewSession = require("../models/InterviewSession");
const Problem = require("../models/Problem");
const CandidateTopicWeakness = require("../models/CandidateTopicWeakness");
const SystemDesignArticle = require("../models/SystemDesignArticle");
const EmbeddingChunk = require("../models/EmbeddingChunk");
const { TOPIC_TAXONOMY, getTopicsByCategory } = require("../constants/topicTaxonomy");
const ragService = require("../services/rag.service");
const logger = require("../config/logger");
const { buildGoogleSearchUrl } = require("../utils/search.utils");

// ── Codeforces Telemetry ──────────────────────────────────────────

exports.getCodeforcesStats = async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle || typeof handle !== "string") return res.status(400).json({ error: "Handle is required" });
    const cleanHandle = String(handle).trim().slice(0, 50);
    if (!/^[a-zA-Z0-9_.-]+$/.test(cleanHandle)) return res.status(400).json({ error: "Invalid handle format" });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response;
    try {
      response = await fetch(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(cleanHandle)}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    const data = await response.json();

    if (data.status === "OK" && data.result.length > 0) {
      res.json({ stats: data.result[0] });
    } else {
      res.status(404).json({ error: "User not found on Codeforces" });
    }
  } catch (error) {
    if (error.name === "AbortError") {
      return res.status(504).json({ error: "Codeforces request timed out" });
    }
    logger.error("Error fetching Codeforces stats", error);
    res.status(500).json({ error: "Failed to fetch Codeforces stats" });
  }
};

exports.getCodeforcesRatingHistory = async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle || typeof handle !== "string") return res.status(400).json({ error: "Handle is required" });
    const cleanHandle = String(handle).trim().slice(0, 50);
    if (!/^[a-zA-Z0-9_.-]+$/.test(cleanHandle)) return res.status(400).json({ error: "Invalid handle format" });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(`https://codeforces.com/api/user.rating?handle=${encodeURIComponent(cleanHandle)}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    const data = await response.json();

    if (data.status === "OK") {
      res.json({ history: data.result });
    } else {
      res.status(404).json({ error: "User not found on Codeforces" });
    }
  } catch (error) {
    if (error.name === "AbortError") {
      return res.status(504).json({ error: "Codeforces request timed out" });
    }
    logger.error("Error fetching Codeforces rating history", error);
    res.status(500).json({ error: "Failed to fetch rating history" });
  }
};

exports.getCodeforcesSubmissions = async (req, res) => {
  try {
    const { handle } = req.params;
    const { count = 50 } = req.query;
    if (!handle || typeof handle !== "string") return res.status(400).json({ error: "Handle is required" });
    const cleanHandle = String(handle).trim().slice(0, 50);
    if (!/^[a-zA-Z0-9_.-]+$/.test(cleanHandle)) return res.status(400).json({ error: "Invalid handle format" });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      const countNum = parseInt(count, 10) || 50;
      response = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(cleanHandle)}&from=1&count=${Math.min(countNum, 100)}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    const data = await response.json();

    if (data.status === "OK") {
      res.json({ submissions: data.result });
    } else {
      res.status(404).json({ error: "User not found on Codeforces" });
    }
  } catch (error) {
    if (error.name === "AbortError") {
      return res.status(504).json({ error: "Codeforces request timed out" });
    }
    logger.error("Error fetching Codeforces submissions", error);
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
};

exports.getCodeforcesProblemRecommendations = async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle || typeof handle !== "string") return res.status(400).json({ error: "Handle is required" });
    const cleanHandle = String(handle).trim().slice(0, 50);
    if (!/^[a-zA-Z0-9_.-]+$/.test(cleanHandle)) return res.status(400).json({ error: "Invalid handle format" });

    // Fetch user's recent submissions to determine weak areas
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let subResponse;
    try {
      subResponse = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(cleanHandle)}&from=1&count=100`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    const subData = await subResponse.json();

    if (subData.status !== "OK") {
      return res.status(404).json({ error: "User not found on Codeforces" });
    }

    // Analyze submissions: find unsolved problems by rating/tags
    const solved = new Set();
    const attempted = new Map();
    const tagCounts = new Map();
    const ratingCounts = new Map();

    for (const sub of subData.result) {
      const problem = sub.problem;
      if (!problem) continue;
      const key = `${problem.contestId}-${problem.index}`;
      
      if (sub.verdict === "OK") {
        solved.add(key);
      } else {
        attempted.set(key, (attempted.get(key) || 0) + 1);
      }
      
      if (problem.tags) {
        for (const tag of problem.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
      if (problem.rating) {
        ratingCounts.set(problem.rating, (ratingCounts.get(problem.rating) || 0) + 1);
      }
    }

    // Get user's current rating to recommend appropriate problems
    let userRating = 1200;
    try {
      const infoResponse = await fetch(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(cleanHandle)}`);
      const infoData = await infoResponse.json();
      if (infoData.status === "OK" && infoData.result[0]?.rating) {
        userRating = infoData.result[0].rating;
      }
    } catch {}

    // Find problemset to recommend from (we'll use a curated list or the Problem model)
    // For now, return analysis of weak areas
    const weakTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, attempts: count }));

    const avgRating = ratingCounts.size > 0 
      ? Array.from(ratingCounts.entries()).reduce((sum, [r, c]) => sum + r * c, 0) / Array.from(ratingCounts.values()).reduce((a, b) => a + b, 0)
      : userRating;

    res.json({
      userRating,
      solvedCount: solved.size,
      attemptedCount: attempted.size,
      weakTags,
      recommendedRatingRange: {
        min: Math.max(800, Math.floor(userRating - 200)),
        max: Math.floor(userRating + 100),
      },
      suggestions: [
        `Focus on problems rated ${Math.max(800, userRating - 100)}-${userRating + 100}`,
        `Weak areas: ${weakTags.map(t => t.tag).join(", ")}`,
        `Solved ${solved.size} unique problems`,
      ],
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return res.status(504).json({ error: "Codeforces request timed out" });
    }
    logger.error("Error fetching Codeforces recommendations", error);
    res.status(500).json({ error: "Failed to fetch recommendations" });
  }
};

// ── Problems API (DSA Sheet & OA Sheet) ──────────────────────────

exports.getProblems = async (req, res) => {
  try {
    const {
      source = "dsa",
      company,
      timeWindow,
      difficulty,
      topic,
      search,
      page = 1,
      limit = 30
    } = req.query;

    const filter = { source };

    if (difficulty && difficulty !== "ALL") {
      filter.difficulty = difficulty.toUpperCase();
    }

    if (topic && topic !== "ALL") {
      filter.topics = topic;
    }

    if (company && company !== "ALL") {
      if (source === "oa") {
        filter.oaCompany = company;
      } else {
        filter["companyFrequencies.company"] = company;
      }
    }

    if (timeWindow && timeWindow !== "ALL" && source === "dsa") {
      filter["companyFrequencies.timeWindow"] = timeWindow;
    }

    if (search) {
      filter.title = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    let parsedPage = parseInt(page, 10);
    if (Number.isNaN(parsedPage) || parsedPage < 1) parsedPage = 1;
    if (parsedPage > 1000) parsedPage = 1000;
    let parsedLimit = parseInt(limit, 10);
    if (Number.isNaN(parsedLimit) || parsedLimit < 1) parsedLimit = 30;
    if (parsedLimit > 100) parsedLimit = 100;

    const skip = (parsedPage - 1) * parsedLimit;
    const problems = await Problem.find(filter)
      .sort({ "companyFrequencies.frequency": -1, createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean();

    const total = await Problem.countDocuments(filter);

    // Attach current user's completion progress
    const userId = req.user?._id || req.user?.id;
    let completedSet = new Set();
    if (userId) {
      const progress = await UserProgress.findOne({ user: userId }).lean();
      if (progress) {
        const list = source === "oa" ? progress.completedOAQuestions : progress.completedDSAQuestions;
        completedSet = new Set(list || []);
      }
    }

    const enriched = problems.map(p => ({
      _id: p._id,
      title: p.title,
      link: p.link,
      difficulty: p.difficulty,
      topics: p.topics || [],
      source: p.source,
      oaCompany: p.oaCompany,
      companyFrequencies: p.companyFrequencies || [],
      completed: completedSet.has(p.link)
    }));

    res.json({
      problems: enriched,
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit)
    });
  } catch (error) {
    logger.error("Error fetching problems", error);
    res.status(500).json({ error: "Failed to fetch problems" });
  }
};

exports.getProblemStats = async (req, res) => {
  try {
    const { source = "dsa" } = req.query;

    const companies = await Problem.distinct(
      source === "oa" ? "oaCompany" : "companyFrequencies.company",
      { source }
    );

    const total = await Problem.countDocuments({ source });
    const easy = await Problem.countDocuments({ source, difficulty: "EASY" });
    const medium = await Problem.countDocuments({ source, difficulty: "MEDIUM" });
    const hard = await Problem.countDocuments({ source, difficulty: "HARD" });

    // User completion count
    const userId = req.user?._id || req.user?.id;
    let completedCount = 0;
    if (userId) {
      const progress = await UserProgress.findOne({ user: userId }).lean();
      if (progress) {
        const list = source === "oa" ? progress.completedOAQuestions : progress.completedDSAQuestions;
        completedCount = list?.length || 0;
      }
    }

    res.json({
      companies: companies.filter(Boolean).sort(),
      total,
      completed: completedCount,
      breakdown: { easy, medium, hard }
    });
  } catch (error) {
    logger.error("Error fetching problem stats", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
};

// ── Progress Tracking ─────────────────────────────────────────────

exports.getProgress = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    let progress = await UserProgress.findOne({ user: userId });
    if (!progress) {
      progress = await UserProgress.create({ user: userId, completedDSAQuestions: [], completedOAQuestions: [] });
    }
    res.json({ progress });
  } catch (error) {
    logger.error("Error fetching progress", error);
    res.status(500).json({ error: "Failed to fetch progress" });
  }
};

exports.markProgress = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { type, questionId, completed } = req.body; // type: 'DSA' | 'OA'

    if (!questionId || typeof questionId !== "string") {
      return res.status(400).json({ error: "questionId is required and must be a string" });
    }
    if (String(questionId).length > 2000) {
      return res.status(400).json({ error: "questionId too long" });
    }

    const field = type === "OA" ? "completedOAQuestions" : "completedDSAQuestions";

    // Brutal fix: atomic upsert with $addToSet/$pull to handle concurrent recruiter progress updates without duplicate or lost update
    let update;
    if (completed) {
      update = { $addToSet: { [field]: String(questionId) } };
    } else {
      update = { $pull: { [field]: String(questionId) } };
    }

    const progress = await UserProgress.findOneAndUpdate(
      { user: userId },
      { ...update, $setOnInsert: { user: userId } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ progress });
  } catch (error) {
    if (error.code === 11000) {
      // Retry once on duplicate key race
      try {
        const userId = req.user?._id || req.user?.id;
        const { type, questionId, completed } = req.body;
        const field = type === "OA" ? "completedOAQuestions" : "completedDSAQuestions";
        const prog = await UserProgress.findOne({ user: userId });
        if (prog) {
          if (completed && !prog[field].includes(String(questionId))) prog[field].push(String(questionId));
          else if (!completed) prog[field] = prog[field].filter(id => id !== String(questionId));
          await prog.save();
          return res.json({ progress: prog });
        }
      } catch {}
    }
    logger.error("Error marking progress", error);
    res.status(500).json({ error: "Failed to mark progress" });
  }
};

// ── Personalized Weaknesses & Recommendations ────────────────────

exports.getWeaknesses = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const weaknesses = await CandidateTopicWeakness.find({
      candidate: userId,
      resolved: false
    })
      .populate("sourceSession", "title roomKey scheduledStart status")
      .sort({ createdAt: -1 })
      .lean();

    const enrichedWeaknesses = weaknesses.map(w => ({
      ...w,
      googleSearchUrl: buildGoogleSearchUrl(w.topic, w.category || "CS_FUNDAMENTALS")
    }));

    res.json({ weaknesses: enrichedWeaknesses });
  } catch (error) {
    logger.error("Error fetching weaknesses", error);
    res.status(500).json({ error: "Failed to fetch weaknesses" });
  }
};

exports.resolveWeakness = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;

    const weakness = await CandidateTopicWeakness.findOneAndUpdate(
      { _id: id, candidate: userId },
      { $set: { resolved: true, resolvedAt: new Date() } },
      { new: true }
    );

    if (!weakness) return res.status(404).json({ error: "Weakness not found" });

    res.json({ success: true, weakness });
  } catch (error) {
    logger.error("Error resolving weakness", error);
    res.status(500).json({ error: "Failed to resolve weakness" });
  }
};

exports.searchResources = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: "Query is too short" });
    }
    const query = String(q).trim().slice(0, 300);

    const chunks = await ragService.retrieve(query, {
      namespace: "study_resource",
      topK: 8
    });

    const seen = new Set();
    const results = [];

    for (const chunk of chunks) {
      if (chunk.sourceUrl && !seen.has(chunk.sourceUrl)) {
        seen.add(chunk.sourceUrl);
        const s = typeof chunk.score === "number" ? chunk.score : 0;
        // Mirror rag.service confidence bands for UI chips
        const confidence = s > 0.55 ? "high" : s > 0.30 ? "medium" : s > 0.15 ? "low" : "none";
        results.push({
          title: chunk.sourceTitle || chunk.topic || "Study Resource",
          url: chunk.sourceUrl,
          description: chunk.content,
          topic: chunk.topic,
          score: chunk.score,
          confidence,
          relevancePct: Math.round(Math.min(0.98, s) * 100),
        });
      }
    }

    // Google-like: always surface actionable web links for ANY query (even generic/off-topic)
    const { buildStudySearchLinks } = require("../utils/search.utils");
    const webLinks = buildStudySearchLinks(query);

    res.json({
      results,
      webLinks, // always present — Google, GfG, LeetCode, YouTube, GitHub, Interview Prep
      fallbackUrl: results.length === 0 ? `https://www.geeksforgeeks.org/search/?q=${encodeURIComponent(query)}` : null
    });
  } catch (error) {
    logger.error("Error searching resources", error);
    res.status(500).json({ error: "Failed to search resources" });
  }
};

// ── System Design Knowledge & Articles ───────────────────────────

exports.getSystemDesignTopics = async (req, res) => {
  try {
    const { track = "HLD" } = req.query; // 'HLD' or 'LLD'

    const articles = await SystemDesignArticle.find({
      track: track.toUpperCase(),
      published: true
    }).lean();

    const canonicalTopics = getTopicsByCategory(track.toUpperCase());

    // Curated fallback links for each topic
    const topicCards = canonicalTopics.map(topic => {
      const article = articles.find(a => a.topic === topic);
      return {
        topic,
        track,
        articleSlug: article?.slug || null,
        summary: article?.summary || `Curated high-yield architectural patterns and interview blueprints for ${topic}.`,
        readTimeMinutes: article?.readTimeMinutes || 10,
        externalLinks: article?.externalLinks || [
          { title: `${topic} Guide on GeeksForGeeks`, url: `https://www.geeksforgeeks.org/search/?q=${encodeURIComponent(topic)}` },
          { title: `System Design Primer — ${topic}`, url: "https://github.com/donnemartin/system-design-primer" }
        ]
      };
    });

    res.json({ topics: topicCards });
  } catch (error) {
    logger.error("Error fetching system design topics", error);
    res.status(500).json({ error: "Failed to fetch topics" });
  }
};

// ── Low-Level Design (LLD) Sheet API ──────────────────────────────

const lldProblemsData = require("../data/lld_problems.json");

exports.getLldProblems = async (req, res) => {
  try {
    const { category, difficulty, pattern, search } = req.query;
    let list = [...lldProblemsData];

    if (category && category !== "ALL") {
      list = list.filter(p => p.category.toLowerCase() === category.toLowerCase());
    }

    if (difficulty && difficulty !== "ALL") {
      list = list.filter(p => p.difficulty.toLowerCase() === difficulty.toLowerCase());
    }

    if (pattern && pattern !== "ALL") {
      list = list.filter(p => p.patterns.some(pat => pat.toLowerCase() === pattern.toLowerCase()));
    }

    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(p => 
        p.title.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.patterns.some(pat => pat.toLowerCase().includes(q)) ||
        (p.requirements && p.requirements.some(r => r.toLowerCase().includes(q)))
      );
    }

    // Compute stats
    const categories = Array.from(new Set(lldProblemsData.map(p => p.category)));
    const patterns = Array.from(new Set(lldProblemsData.flatMap(p => p.patterns)));
    const difficultyCounts = {
      Easy: lldProblemsData.filter(p => p.difficulty === "Easy").length,
      Medium: lldProblemsData.filter(p => p.difficulty === "Medium").length,
      Hard: lldProblemsData.filter(p => p.difficulty === "Hard").length,
      Total: lldProblemsData.length
    };

    res.json({
      problems: list,
      total: list.length,
      categories,
      patterns,
      stats: difficultyCounts
    });
  } catch (error) {
    logger.error("Error fetching LLD problems", error);
    res.status(500).json({ error: "Failed to fetch LLD problems" });
  }
};

// ── High-Level Design (HLD) Sheet API ─────────────────────────────

const hldProblemsData = require("../data/hld_problems.json");

exports.getHldProblems = async (req, res) => {
  try {
    const { category, difficulty, search } = req.query;
    let list = [...(hldProblemsData.problems || [])];

    if (category && category !== "ALL") {
      list = list.filter(p => p.category.toLowerCase() === category.toLowerCase());
    }

    if (difficulty && difficulty !== "ALL") {
      list = list.filter(p => p.difficulty.toLowerCase() === difficulty.toLowerCase());
    }

    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(p => 
        p.title.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.patterns.some(pat => pat.toLowerCase().includes(q))
      );
    }

    // Compute stats
    const categories = Array.from(new Set((hldProblemsData.problems || []).map(p => p.category)));
    const difficultyCounts = {
      Easy: (hldProblemsData.problems || []).filter(p => p.difficulty === "Easy").length,
      Medium: (hldProblemsData.problems || []).filter(p => p.difficulty === "Medium").length,
      Hard: (hldProblemsData.problems || []).filter(p => p.difficulty === "Hard").length,
      Total: (hldProblemsData.problems || []).length
    };

    res.json({
      problems: list,
      total: list.length,
      categories,
      stats: difficultyCounts,
      papers: hldProblemsData.papers || [],
      articles: hldProblemsData.articles || [],
      concepts: hldProblemsData.concepts || []
    });
  } catch (error) {
    logger.error("Error fetching HLD problems", error);
    res.status(500).json({ error: "Failed to fetch HLD problems" });
  }
};

// ── Real RAG Chatbot ──────────────────────────────────────────────

exports.ragChatbot = async (req, res) => {
  try {
    const { message, scopeId } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    // Retrieve chunks: if scopeId provided, use blog_content; else global study_resource
    const namespace = scopeId ? "blog_content" : "study_resource";
    const chunks = await ragService.retrieve(message, {
      namespace,
      scopeId: scopeId || null,
      topK: 4
    });

    const result = await ragService.ragAnswer(message, chunks, {
      systemPrompt: "You are the authoritative System Design Oracle. Answer technical questions clearly and concisely based on verified curriculum references."
    });

    res.json({
      reply: result.reply,
      sources: result.sources,
      confidence: result.confidence
    });
  } catch (error) {
    logger.error("Error in RAG chatbot", error);
    res.status(500).json({ error: "Failed to process chat message" });
  }
};

// ── General AI Study Tutor (Unrestricted LLM) ─────────────────────

let _aiClient = null;
function getGenAI() {
  throw new Error("getGenAI() is deprecated — use geminiText() which carries the model fallback chain");
}

function buildOfflineTutorReply(message) {
  const q = String(message || "").toLowerCase();
  // Lightweight offline encyclopedia — deterministic fallback when LLM unavailable (CI / local without key)
  if (q.includes("binary search")) {
    return `**Binary Search — Offline Quick Reference**\n\n- **Definition**: Efficient search on sorted arrays by repeatedly halving the search space.\n- **Time**: O(log n) · **Space**: O(1) iterative, O(log n) recursive.\n- **Invariant**: Maintain \`lo <= hi\`; mid = lo + (hi-lo)/2 to avoid overflow.\n- **Pitfalls**: Ensure array is sorted; off-by-one on duplicates; integer overflow on mid in some languages.\n- **Variants**: lower_bound / upper_bound, search in rotated array, peak element.\n\n*Tip*: For interview depth, ask specifically about “binary search on answer” pattern.`;
  }
  if (q.includes("cap theorem")) {
    return `**CAP Theorem — Offline Quick Reference**\n\n- **Consistency**: Every read receives the most recent write or error.\n- **Availability**: Every request receives a (non-error) response.\n- **Partition Tolerance**: System continues despite network partitions.\n- **Implication**: In presence of partition, you choose CP or AP; PACELC extends this to latency vs consistency when no partition.\n- **Examples**: CP — ZooKeeper, etcd; AP — Cassandra, Dynamo.`;
  }
  return `**Offline Tutor Response (LLM unavailable)**\n\nYou asked: "${String(message).slice(0, 500)}"\n\nThis is a high-quality offline fallback. For a full Gemini-powered explanation with code examples, configure \`GEMINI_API_KEY\`. Meanwhile, try our **Grounded** mode (curated curriculum with citations) or browse the System Design & LLD problem sheets.\n\n**General guidance**:\n- State definitions first, then trade-offs and complexities.\n- Include a tiny code snippet or diagram description.\n- Mention time/space Big-O and when to use the concept in interviews.`;
}

exports.generalTutor = async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    // If no valid Gemini key (CI / local), return deterministic offline reply instead of 500
    const hasValidKey = process.env.GEMINI_API_KEY && !String(process.env.GEMINI_API_KEY).includes("your_gemini_api_key");
    if (!hasValidKey) {
      return res.json({ reply: buildOfflineTutorReply(message), timestamp: new Date(), offline: true });
    }

    // Format conversation history for context
    const conversationContext = history
      .slice(-6) // keep last 6 turns for context
      .map(h => `${h.role === "user" ? "User" : "Assistant"}: ${h.text}`)
      .join("\n\n");

    const prompt = `
You are the Jobly AI Master Study Tutor — a senior computer scientist, principal software engineer, and elite technical interview mentor.
You can answer ANY question across Operating Systems, Data Structures & Algorithms, System Design, Computer Networks, DBMS, OOP, Language Internals (C++, Java, Python, JS, Rust, Go), and Engineering Interview Preparation.

Previous Conversation:
${conversationContext ? conversationContext + "\n\n" : "(No prior conversation)"}

User Question:
"${message.trim()}"

Instructions:
- Provide a clear, comprehensive, and authoritative technical explanation.
- Include conceptual definitions, real-world examples, trade-offs, and clean code snippets where helpful.
- Use markdown formatting with bullet points and bold terms for readability.
- If asked about an algorithm or data structure, explain time/space complexities (Big-O).
 `;

    try {
      const { generateWithFallback } = require("../modules/ai/providers/geminiClient");
      const replyText = await generateWithFallback(process.env.GEMINI_API_KEY, {
        contents: prompt,
        config: undefined, // plain text reply (markdown), not JSON
      });
      return res.json({ reply: replyText, timestamp: new Date() });
    } catch (genErr) {
      logger.warn({ err: genErr.message }, "Gemini tutor generation failed, returning offline fallback");
      return res.json({ reply: buildOfflineTutorReply(message), timestamp: new Date(), offline: true, fallbackReason: genErr.message });
    }
  } catch (error) {
    logger.error("Error in AI Study Tutor", error);
    res.status(500).json({ error: "Failed to process tutor query: " + (error.message || "Unknown error") });
  }
};

// ── Legacy Backwards-Compatibility Bridge ─────────────────────────

exports.getRepoData = async (req, res) => {
  try {
    const { repo } = req.query; // 'leetcode' or 'oa'
    const source = repo === "oa" ? "oa" : "dsa";

    const problems = await Problem.find({ source }).limit(50).lean();
    const questions = problems.map(p => ({
      title: `${p.title} (${p.difficulty})`,
      url: p.link
    }));

    const markdown = questions.map(q => `- [${q.title}](${q.url})`).join("\n");
    res.json({ markdown, questions });
  } catch (error) {
    logger.error("Error fetching repo data", error);
    res.status(500).json({ error: "Failed to fetch repo data" });
  }
};

exports.getInterviewTopics = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const weaknesses = await CandidateTopicWeakness.find({
      candidate: userId,
      resolved: false
    }).lean();

    const topics = weaknesses.map(w => w.topic);
    res.json({ topics });
  } catch (error) {
    logger.error("Error fetching interview topics", error);
    res.status(500).json({ error: "Failed to fetch interview topics" });
  }
};
