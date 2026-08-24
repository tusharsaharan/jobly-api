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

// ── Codeforces Telemetry ──────────────────────────────────────────

exports.getCodeforcesStats = async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle) return res.status(400).json({ error: "Handle is required" });

    const response = await fetch(`https://codeforces.com/api/user.info?handles=${handle}`);
    const data = await response.json();

    if (data.status === "OK" && data.result.length > 0) {
      res.json({ stats: data.result[0] });
    } else {
      res.status(404).json({ error: "User not found on Codeforces" });
    }
  } catch (error) {
    logger.error("Error fetching Codeforces stats", error);
    res.status(500).json({ error: "Failed to fetch Codeforces stats" });
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

    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const problems = await Problem.find(filter)
      .sort({ "companyFrequencies.frequency": -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
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
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
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

    let progress = await UserProgress.findOne({ user: userId });
    if (!progress) {
      progress = await UserProgress.create({ user: userId, completedDSAQuestions: [], completedOAQuestions: [] });
    }

    const field = type === "OA" ? "completedOAQuestions" : "completedDSAQuestions";

    if (completed) {
      if (!progress[field].includes(questionId)) {
        progress[field].push(questionId);
      }
    } else {
      progress[field] = progress[field].filter(id => id !== questionId);
    }

    await progress.save();
    res.json({ progress });
  } catch (error) {
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

    res.json({ weaknesses });
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

    const chunks = await ragService.retrieve(q, {
      namespace: "study_resource",
      topK: 5
    });

    const seen = new Set();
    const results = [];

    for (const chunk of chunks) {
      if (chunk.sourceUrl && !seen.has(chunk.sourceUrl)) {
        seen.add(chunk.sourceUrl);
        results.push({
          title: chunk.sourceTitle || chunk.topic || "Study Resource",
          url: chunk.sourceUrl,
          description: chunk.content,
          topic: chunk.topic,
          score: chunk.score
        });
      }
    }

    res.json({
      results,
      fallbackUrl: results.length === 0 ? `https://www.geeksforgeeks.org/search/?q=${encodeURIComponent(q)}` : null
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
  if (!_aiClient) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
    const { GoogleGenAI } = require("@google/genai");
    _aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _aiClient;
}

exports.generalTutor = async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const ai = getGenAI();

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

    const response = await ai.models.generateContent({
      model: "gemini-flash-lite-latest",
      contents: prompt,
    });

    res.json({
      reply: response.text,
      timestamp: new Date()
    });
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
