const mongoose = require("mongoose");
const Job = require("../models/Job");
const Application = require("../models/Application");
const logger = require("../config/logger");

class JdInsightsService {
  /**
   * Aggregates platform hiring outcomes for a role category.
   * STRICT GUARDRAIL: Requires N >= 15 total applications across >= 3 historical jobs
   * before returning data to prevent hallucinating trends on small N.
   */
  async getHighPerformingPatterns(title, skills = []) {
    try {
      if (!title || title.trim().length < 2) return null;

      const titleWords = title.trim().split(/\s+/).filter(w => w.length > 2);
      const titleRegex = titleWords.length > 0 ? new RegExp(titleWords.join("|"), "i") : new RegExp(title, "i");

      // 1. Find matching jobs
      const matchingJobs = await Job.find({
        $or: [
          { title: { $regex: titleRegex } },
          ...(skills.length > 0 ? [{ skills: { $in: skills.map(s => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")) } }] : [])
        ]
      }).select("_id title description skills salaryRange atsRequirements createdAt").lean();

      if (!matchingJobs || matchingJobs.length < 3) {
        // Cold start guardrail: fewer than 3 historical jobs
        return null;
      }

      const jobIds = matchingJobs.map(j => j._id);

      // 2. Aggregate applications for these jobs
      const appStats = await Application.aggregate([
        { $match: { job: { $in: jobIds } } },
        {
          $group: {
            _id: "$job",
            totalApps: { $sum: 1 },
            shortlistedCount: {
              $sum: { $cond: [{ $eq: ["$status", "shortlisted"] }, 1, 0] }
            },
            avgAtsScore: { $avg: "$atsScore" }
          }
        }
      ]);

      const totalApplications = appStats.reduce((sum, s) => sum + (s.totalApps || 0), 0);

      // Cold start guardrail: fewer than 15 total applications
      if (totalApplications < 15) {
        return null;
      }

      // Map stats back to jobs
      const statsMap = new Map();
      for (const stat of appStats) {
        statsMap.set(stat._id.toString(), {
          totalApps: stat.totalApps,
          shortlistRate: stat.totalApps > 0 ? (stat.shortlistedCount / stat.totalApps) : 0,
          avgAtsScore: stat.avgAtsScore || 0
        });
      }

      const enrichedJobs = matchingJobs.map(job => {
        const stat = statsMap.get(job._id.toString()) || { totalApps: 0, shortlistRate: 0, avgAtsScore: 0 };
        return {
          ...job,
          totalApps: stat.totalApps,
          shortlistRate: stat.shortlistRate,
          avgAtsScore: stat.avgAtsScore
        };
      }).filter(j => j.totalApps >= 3); // Must have at least 3 applicants to be considered

      // Sort by shortlist rate and ATS score
      enrichedJobs.sort((a, b) => (b.shortlistRate * 0.7 + (b.avgAtsScore / 100) * 0.3) - (a.shortlistRate * 0.7 + (a.avgAtsScore / 100) * 0.3));

      const topPerforming = enrichedJobs.slice(0, 2);
      if (topPerforming.length === 0) return null;

      const avgPlatformShortlistRate = Math.round(
        (appStats.reduce((sum, s) => sum + (s.shortlistedCount || 0), 0) / totalApplications) * 100
      );

      const topSnippets = topPerforming.map(j => {
        // Extract first ~400 characters of description as high-performing tone snippet
        return String(j.description).slice(0, 400).trim();
      });

      return {
        isSufficientData: true,
        jobCount: matchingJobs.length,
        totalApplications,
        avgShortlistRate: avgPlatformShortlistRate,
        topSnippets,
        insightSummary: `Postings for ${title} with outcome-oriented responsibilities had an average ${avgPlatformShortlistRate}% shortlist rate across ${totalApplications} candidate applications on Jobly.`
      };
    } catch (err) {
      logger.error({ err: err.message }, "Error in getHighPerformingPatterns");
      return null;
    }
  }
}

module.exports = new JdInsightsService();
