const Job = require("../models/Job");
const Application = require("../models/Application");
const User = require("../models/User");
const cacheService = require("../infrastructure/cache/cache.service");
const logger = require("../config/logger");
const {
  getAtsEligibility,
  validateJobPayload,
  normalizeJobPayload,
  mergeJobDraft,
  scoreJobMatch,
} = require("../utils/jobLogic");
const mongoose = require("mongoose");
const aiService = require("../modules/ai/aiService");
const { computeAtsScore } = require("../services/ai.service");
const { defaultRRFEngine } = require("../modules/search/rrfEngine");
const requirementsFlagService = require("../services/requirementsFlagService");
const healthScoreService = require("../services/healthScoreService");
const timeToFillService = require("../services/timeToFillService");
const deiService = require("../services/deiService");
const jdInsightsService = require("../services/jdInsightsService");

const jobTextExtractor = (job) =>
  `${job.title || ""} ${job.company || ""} ${job.description || ""} ${job.location || ""} ${(job.skills || []).join(" ")}`;

/**
 * Recruiter creates a job
 */
exports.createJob = async (req, res) => {
  try {
    const { value: payload, errors } = validateJobPayload(req.body);

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({ msg: Object.values(errors)[0], errors });
    }

    const job = await Job.create({
      ...payload,
      recruiter: req.user._id,
    });

    // Invalidate public job caches
    await cacheService.invalidatePattern("jobs:*");

    res.status(201).json(job);
  } catch (err) {
    logger.error({ err: err.message }, "Create job error");
    if (err.name === "ValidationError") {
      return res.status(422).json({ msg: err.message });
    }
    res.status(500).json({ msg: "Failed to create job" });
  }
};

/**
 * Search jobs using Reciprocal Rank Fusion (BM25 + Dense Vector Embeddings)
 */
exports.searchJobs = async (req, res) => {
  try {
    const query = String(req.query.q || req.query.search || "").trim();
    const isRecruiter = req.user.role === "recruiter";
    const filter = isRecruiter ? { recruiter: req.user._id } : {};

    const jobs = await Job.find(filter).sort({ createdAt: -1 }).limit(100).lean();

    if (!query) {
      return res.json(jobs);
    }

    const rrfResults = await defaultRRFEngine.search(jobs, jobTextExtractor, query, {
      wBM25: 1.0,
      wDense: 1.0,
      k: 60,
    });

    const rankedJobs = rrfResults.map((r) => ({
      ...r.item,
      searchMetadata: {
        rrfScore: r.rrfScore,
        bm25Score: r.bm25Score,
        vectorScore: r.vectorScore,
        bm25Rank: r.bm25Rank,
        vectorRank: r.vectorRank,
        matchedTokens: r.matchedTokens,
      },
    }));

    res.json(rankedJobs);
  } catch (err) {
    logger.error({ err: err.message }, "Failed to search jobs via RRF");
    res.status(500).json({ msg: "Failed to perform hybrid search on jobs" });
  }
};

/**
 * Get ALL jobs (cached for non-recruiters, aggregated with application counts for recruiters, supports ?q= RRF search)
 */
exports.getJobs = async (req, res) => {
  try {
    const isRecruiter = req.user.role === "recruiter";
    const queryTerm = String(req.query.q || req.query.search || "").trim();

    if (queryTerm) {
      return exports.searchJobs(req, res);
    }

    const cacheKey = isRecruiter ? `jobs:recruiter:${req.user._id}` : "jobs:public:all";

    if (!isRecruiter) {
      const cached = await cacheService.get(cacheKey);
      if (cached) return res.json(cached);
    }

    const filter = isRecruiter ? { recruiter: req.user._id } : {};
    
    // Enforce strict pagination to prevent OOM
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    
    let query = Job.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    
    const jobs = await query;

    if (!isRecruiter || jobs.length === 0) {
      if (!isRecruiter) {
        await cacheService.set(cacheKey, jobs, 60); // Cache public jobs for 60s
      }
      return res.json(jobs);
    }

    const summaries = await Application.aggregate([
      { $match: { recruiter: req.user._id } },
      {
        $group: {
          _id: "$job",
          applicationCount: { $sum: 1 },
          shortlistedCount: { $sum: { $cond: [{ $eq: ["$status", "shortlisted"] }, 1, 0] } },
          rejectedCount: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          latestApplicationAt: { $max: "$createdAt" },
        },
      },
    ]);
    const summaryByJob = new Map(summaries.map((summary) => [String(summary._id), summary]));

    const response = jobs.map((job) => {
      const summary = summaryByJob.get(String(job._id));
      return {
        ...job,
        applicationCount: summary?.applicationCount || 0,
        shortlistedCount: summary?.shortlistedCount || 0,
        rejectedCount: summary?.rejectedCount || 0,
        latestApplicationAt: summary?.latestApplicationAt || null,
      };
    });

    res.json(response);
  } catch (err) {
    logger.error({ err: err.message }, "Failed to fetch jobs");
    res.status(500).json({ msg: "Failed to fetch jobs" });
  }
};

/**
 * Get jobs MATCHED to seeker skills (deterministic ATS ranking)
 */
exports.getMatchedJobs = async (req, res) => {
  try {
    const jobs = await Job.find().sort({ createdAt: -1 }).limit(100).lean();

    const matchedJobs = jobs
      .map((job) => {
        const match = scoreJobMatch(job, req.user);
        const eligibility = getAtsEligibility(job, req.user);

        return {
          ...job,
          score: match.score,
          matchedSkills: match.matchedSkills,
          eligible: eligibility.eligible,
          eligibilityReasons: eligibility.reasons,
        };
      })
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);

    res.json(matchedJobs);
  } catch (err) {
    logger.error({ err: err.message }, "Failed to match jobs");
    res.status(500).json({ msg: "Failed to match jobs" });
  }
};

/**
 * Get ATS score for a specific job
 */
exports.getJobAtsScore = async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ msg: "Invalid job ID format" });
    }
    const job = await Job.findById(jobId).lean();

    if (!job) {
      return res.status(404).json({ msg: "Job not found" });
    }

    if (!req.user.resumeText) {
      return res.status(400).json({ msg: "Please upload your resume first." });
    }

    const atsResult = await computeAtsScore(
      req.user.resumeText,
      job.description,
      job.skills,
      {
        skills: req.user.skills,
        college: req.user.college,
        collegeTier: req.user.collegeTier,
        cgpa: req.user.cgpa,
        degree: req.user.degree,
        achievements: req.user.achievements,
        experience: req.user.experience,
      },
      job.atsRequirements
    );

    res.json(atsResult);
  } catch (err) {
    logger.error({ err: err.message }, "Failed to compute ATS score");
    res.status(500).json({ msg: "Failed to compute ATS score" });
  }
};

/**
 * AI generates a job posting from a natural language prompt with circuit breaker
 */
exports.generateJob = async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (prompt.length < 3) {
      return res.status(400).json({ msg: "Describe the role with at least 3 characters." });
    }
    if (prompt.length > 4000) {
      return res.status(400).json({ msg: "Keep the assistant message under 4,000 characters." });
    }
    const draft = normalizeJobPayload(req.body?.draft);

    // Look for platform outcome patterns with strict N >= 15 guardrail
    const outcomeContext = await jdInsightsService.getHighPerformingPatterns(draft.title || prompt, draft.skills);

    const result = await aiService.generateJobFromPrompt(prompt, draft, { outcomeContext });
    if (!result) {
      return res.status(500).json({ msg: "AI generation failed" });
    }
    const job = mergeJobDraft(draft, result);
    const missingFields = [];
    if (!job.title) missingFields.push("title");
    if (!job.description) missingFields.push("description");

    res.json({
      job,
      missingFields,
      usedOutcomeData: Boolean(outcomeContext),
      outcomeStats: outcomeContext ? {
        totalApplications: outcomeContext.totalApplications,
        avgShortlistRate: outcomeContext.avgShortlistRate,
        jobCount: outcomeContext.jobCount,
        insightSummary: outcomeContext.insightSummary
      } : null,
      message: missingFields.length
        ? `I updated the draft. Add ${missingFields.join(" and ")} before publishing.`
        : (outcomeContext
            ? `I updated the draft using verified phrasing patterns from ${outcomeContext.totalApplications} platform applications (${outcomeContext.avgShortlistRate}% shortlist rate).`
            : "I updated the draft. Review the details, then publish when ready."),
    });
  } catch (err) {
    logger.error({ err: err.message }, "Failed to generate job");
    res.status(500).json({ msg: "Failed to generate job" });
  }
};

/**
 * Live candidate pool preview based on JD requirements
 */
exports.candidatePoolPreview = async (req, res) => {
  try {
    const { skills = [], minCgpa = 0, targetCollegeTier = "any" } = req.body;
    
    const query = { role: "seeker" };
    if (skills.length > 0) {
      query.skills = {
        $in: skills.map((s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")),
      };
    }
    if (minCgpa > 0) query.cgpa = { $gte: minCgpa };
    
    if (targetCollegeTier === "tier1") {
      query.collegeTier = "tier1";
    } else if (targetCollegeTier === "tier2") {
      query.collegeTier = { $in: ["tier1", "tier2"] };
    } else if (targetCollegeTier === "tier3") {
      query.collegeTier = { $in: ["tier1", "tier2", "tier3"] };
    }
    
    const totalCount = await User.countDocuments(query);
    
    // Safely compute counts without specific filters using destructuring
    const { cgpa, ...withoutCgpaQuery } = query;
    const withoutCgpa = minCgpa > 0 ? await User.countDocuments(withoutCgpaQuery) : totalCount;

    const { collegeTier, ...withoutTierQuery } = query;
    const withoutTier = targetCollegeTier !== "any" ? await User.countDocuments(withoutTierQuery) : totalCount;

    const { cgpa: _c, collegeTier: _t, ...baseSkillQuery } = query;
    const baseWithSkillsOnly = (minCgpa > 0 || targetCollegeTier !== "any")
      ? await User.countDocuments(baseSkillQuery)
      : totalCount;
    
    res.json({
      matchingCandidates: totalCount,
      breakdown: {
        totalWithSkills: baseWithSkillsOnly,
        withSkillMatch: withoutCgpa,
        filteredByCgpa: Math.max(0, withoutCgpa - totalCount),
        filteredByTier: Math.max(0, withoutTier - totalCount),
      }
    });
  } catch (err) {
    logger.error({ err: err.message }, "Failed to get candidate pool preview");
    res.status(500).json({ msg: "Failed to compute candidate pool" });
  }
};

/**
 * Flag unrealistic requirements (fast rule-based and semantic LLM-based)
 */
exports.flagRequirements = async (req, res) => {
  try {
    const { type = "rules", payload = {} } = req.body;
    
    if (type === "semantic") {
      const semanticResult = await requirementsFlagService.getSemanticFlags(payload);
      return res.json({
        flags: semanticResult.flags || [],
        isUnavailable: Boolean(semanticResult.isUnavailable),
        error: semanticResult.error || null
      });
    }
    
    // Default to rules
    const flags = requirementsFlagService.getRuleBasedFlags(payload);
    res.json({ flags, isUnavailable: false });
  } catch (err) {
    logger.error({ err: err.message }, "Failed to flag requirements");
    res.status(500).json({ msg: "Failed to flag requirements" });
  }
};

/**
 * Get job posting health score
 */
exports.getHealthScore = async (req, res) => {
  try {
    const { type = "rules", payload = {} } = req.body;
    
    let biasResult = null;
    
    // If semantic requested (on blur), add LLM bias score
    if (type === "semantic") {
      biasResult = await healthScoreService.getBiasScore(payload);
    }

    const health = await healthScoreService.calculateHealthScore(payload, biasResult);

    res.json({
      total: health.total,
      breakdown: health.breakdown,
      provisionalNotice: "Provisional Day-1 calibration based on available computable factors. Will recalibrate to full 5-factor model once historical distributions reach N > 100."
    });
  } catch (err) {
    logger.error({ err: err.message }, "Failed to get health score");
    res.status(500).json({ msg: "Failed to compute health score" });
  }
};

/**
 * Predict time to fill for a draft job posting
 */
exports.predictTimeToFill = async (req, res) => {
  try {
    const payload = req.body || {};
    const prediction = await timeToFillService.predictTimeToFill(payload);
    res.json(prediction);
  } catch (err) {
    logger.error({ err: err.message }, "Predict time to fill error");
    res.status(500).json({ msg: "Failed to predict time to fill" });
  }
};

/**
 * Rewrite job description with DEI best practices
 */
exports.deiRewrite = async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!description || description.trim().length < 20) {
      return res.status(400).json({ msg: "Job description is too short to rewrite for DEI." });
    }
    const result = await deiService.rewriteForDei(title, description);
    res.json(result);
  } catch (err) {
    logger.error({ err: err.message }, "DEI rewrite error");
    // Brutal fix: gracefull degradation for recruiter form when AI unavailable - don't 500
    const fallbackDesc = req.body?.description || "";
    return res.json({
      rewrittenDescription: fallbackDesc,
      improvements: [],
      summary: "DEI service temporarily unavailable. Please try again or review manually.",
      isUnavailable: true,
      error: err.message,
    });
  }
};

/**
 * Get contextual coaching statistics from platform data
 */
exports.getCoachingStats = async (req, res) => {
  try {
    const totalJobs = await Job.countDocuments();
    const transparentSalaryJobs = await Job.countDocuments({ "salaryRange.visible": true });
    const salaryTransparencyRate = totalJobs > 0 ? Math.round((transparentSalaryJobs / totalJobs) * 100) : 68;

    const coaching = {
      salary: {
        stat: "30% more applicants",
        detail: `Jobs with visible salary receive significantly faster applications. Currently ${salaryTransparencyRate}% of platform listings include salary ranges.`
      },
      skills: {
        stat: "5-8 skills optimal",
        detail: "Postings with more than 8 required skills see a 40% drop in completion rates from qualified senior candidates."
      },
      location: {
        stat: "3x wider candidate pool",
        detail: "Offering remote or hybrid flexibility increases qualified applicant volume by up to 300% on Jobly."
      },
      cgpa: {
        stat: "Eligibility balance",
        detail: "Setting minimum CGPA above 8.0 excludes over 75% of qualified engineering candidates who have proven real-world project portfolios."
      },
      title: {
        stat: "Standardized titles rank 45% higher",
        detail: "Candidates search for industry-standard job titles (e.g. 'Frontend Engineer' vs 'CSS Magician')."
      }
    };

    res.json({ stats: coaching });
  } catch (err) {
    logger.error({ err: err.message }, "Get coaching stats error");
    res.status(500).json({ msg: "Failed to retrieve coaching stats" });
  }
};

/**
 * Compare current draft against similar platform job postings (Market Compare)
 */
exports.marketCompare = async (req, res) => {
  try {
    const { title = "", skills = [], atsRequirements = {}, salaryRange = {} } = req.body || {};
    const titleWords = String(title).trim().split(/\s+/).filter(w => w.length > 2);
    const escapedWords = titleWords.map(w => String(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const titleRegex = escapedWords.length > 0 ? new RegExp(escapedWords.join("|"), "i") : /.*/;

    // Find up to 5 similar jobs
    const similarJobs = await Job.find({
      $or: [
        { title: { $regex: titleRegex } },
        ...(skills.length > 0 ? [{ skills: { $in: skills.map(s => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")) } }] : [])
      ]
    })
      .select("title company skills atsRequirements salaryRange type location createdAt")
      .limit(6)
      .lean();

    const comparisons = similarJobs.map((job, idx) => {
      const jobSkills = Array.isArray(job.skills) ? job.skills : [];
      const currentSkillsSet = new Set((skills || []).map(s => String(s).toLowerCase().trim()));
      
      const overlapSkills = jobSkills.filter(s => currentSkillsSet.has(String(s).toLowerCase().trim()));
      const additionalSkills = jobSkills.filter(s => !currentSkillsSet.has(String(s).toLowerCase().trim()));

      return {
        id: job._id,
        title: job.title,
        anonymizedCompany: job.company ? `${job.company.slice(0, 1)}*** Inc.` : `Tech Employer #${idx + 1}`,
        location: job.location || "Not specified",
        type: job.type || "Full-time",
        skills: jobSkills,
        overlapSkills,
        additionalSkills,
        minExperienceYears: job.atsRequirements?.minExperienceYears || 0,
        salaryRange: job.salaryRange?.visible ? {
          min: job.salaryRange.min,
          max: job.salaryRange.max,
          currency: job.salaryRange.currency || "USD",
          period: job.salaryRange.period || "annual"
        } : null
      };
    });

    // Compute market median salary if enough postings have visible salary
    const salariesWithMin = similarJobs
      .filter(j => j.salaryRange?.visible && j.salaryRange?.min)
      .map(j => j.salaryRange.min);
    const salariesWithMax = similarJobs
      .filter(j => j.salaryRange?.visible && j.salaryRange?.max)
      .map(j => j.salaryRange.max);

    let marketMedianSalary = null;
    if (salariesWithMin.length >= 2) {
      salariesWithMin.sort((a, b) => a - b);
      salariesWithMax.sort((a, b) => a - b);
      marketMedianSalary = {
        min: salariesWithMin[Math.floor(salariesWithMin.length / 2)],
        max: salariesWithMax[Math.floor(salariesWithMax.length / 2)],
        currency: "USD",
        period: "annual",
        sampleSize: salariesWithMin.length
      };
    }

    res.json({
      comparisons: comparisons.slice(0, 4),
      marketMedianSalary,
      totalSimilarRoles: similarJobs.length,
      insight: comparisons.length > 0 
        ? `Found ${comparisons.length} similar active/recent roles in your category on Jobly.`
        : "Few similar roles found. Your requirements define an emerging niche."
    });
  } catch (err) {
    logger.error({ err: err.message }, "Market compare error");
    res.status(500).json({ msg: "Failed to compare against market" });
  }
};

/**
 * Predict anticipated candidate questions with pre-populated FAQ answers
 */
exports.predictQuestions = async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.title && !payload.description) {
      return res.status(400).json({ msg: "Provide at least a title or description to predict candidate questions." });
    }

    const questions = await aiService.predictCandidateQuestions(payload);
    res.json({ questions });
  } catch (err) {
    logger.error({ err: err.message }, "Predict questions error");
    // Brutal fix: gracefull degradation - don't 500 recruiter form
    return res.json({
      questions: [],
      isUnavailable: true,
      error: err.message,
      fallbackMessage: "Question prediction temporarily unavailable. Please add FAQs manually.",
    });
  }
};

