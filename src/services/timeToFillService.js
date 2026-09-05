const Job = require("../models/Job");
const Application = require("../models/Application");
const logger = require("../config/logger");

class TimeToFillService {
  /**
   * Jaccard similarity between two skill arrays
   */
  calculateSkillOverlap(skills1 = [], skills2 = []) {
    const s1 = new Set(skills1.map(s => String(s).toLowerCase().trim()));
    const s2 = new Set(skills2.map(s => String(s).toLowerCase().trim()));
    if (s1.size === 0 && s2.size === 0) return 0;
    
    let intersection = 0;
    for (const skill of s1) {
      if (s2.has(skill)) intersection++;
    }
    const union = new Set([...s1, ...s2]).size;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Predict time to fill based on historical data + requirement complexity
   */
  async predictTimeToFill(jobPayload) {
    try {
      const skills = Array.isArray(jobPayload.skills) ? jobPayload.skills : [];
      const title = String(jobPayload.title || "").trim();
      const ats = jobPayload.atsRequirements || {};
      const minExp = Number(ats.minExperienceYears) || 0;
      const minCgpa = Number(ats.minCgpa) || 0;
      const collegeTier = ats.targetCollegeTier || "any";
      const salary = jobPayload.salaryRange || {};
      const location = String(jobPayload.location || "").toLowerCase();
      const isRemote = location.includes("remote");

      // 1. Query historical completed or older jobs for empirical comparison
      const titleWords = title.split(/\s+/).filter(w => w.length > 2);
      const titleRegex = titleWords.length > 0 ? new RegExp(titleWords.join("|"), "i") : /.*/;

      const similarJobs = await Job.find({
        $or: [
          { title: { $regex: titleRegex } },
          ...(skills.length > 0 ? [{ skills: { $in: skills.map(s => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")) } }] : [])
        ]
      }).limit(50).lean();

      let historicalDays = [];
      let stalledCount = 0;

      for (const histJob of similarJobs) {
        // 1. If job has explicit closure data
        if (histJob.status === "closed" || histJob.closureReason !== "none") {
          if (histJob.closureReason === "filled" && histJob.closedAt) {
            const diffMs = new Date(histJob.closedAt).getTime() - new Date(histJob.createdAt).getTime();
            const days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
            historicalDays.push(days);
            continue;
          } else if (["abandoned", "cancelled", "expired"].includes(histJob.closureReason)) {
            stalledCount++;
            continue;
          }
        }

        // 2. Check application timeline for first shortlisted candidate
        const firstShortlist = await Application.findOne({
          job: histJob._id,
          status: "shortlisted"
        }).sort({ createdAt: 1 }).lean();

        if (firstShortlist) {
          const diffMs = new Date(firstShortlist.createdAt).getTime() - new Date(histJob.createdAt).getTime();
          const days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
          historicalDays.push(days);
        } else {
          // Check if job is older than 25 days without shortlist (stalled/unfilled)
          const ageDays = (Date.now() - new Date(histJob.createdAt).getTime()) / (1000 * 60 * 60 * 24);
          if (ageDays > 25) {
            stalledCount++;
          }
        }
      }

      const totalEvaluated = historicalDays.length + stalledCount;
      const unfilledRate = totalEvaluated > 0 ? Math.round((stalledCount / totalEvaluated) * 100) : 18;

      let baselineDays = 30; // Standard baseline for technical roles
      let confidence = "low";

      if (historicalDays.length >= 5) {
        // Calculate median
        historicalDays.sort((a, b) => a - b);
        const mid = Math.floor(historicalDays.length / 2);
        baselineDays = historicalDays.length % 2 !== 0 
          ? historicalDays[mid] 
          : Math.round((historicalDays[mid - 1] + historicalDays[mid]) / 2);
        confidence = historicalDays.length >= 15 ? "high" : "medium";
      }

      // 2. Modifiers
      const factors = [];
      let multiplier = 1.0;

      // Skills stacked
      if (skills.length > 8) {
        const penalty = (skills.length - 8) * 0.08;
        multiplier += penalty;
        factors.push({
          text: `${skills.length} skills required (+${Math.round(penalty * 100)}% time)`,
          impact: "increase"
        });
      } else if (skills.length >= 3 && skills.length <= 6) {
        factors.push({
          text: "Focused skill requirements (3-6 core skills)",
          impact: "decrease"
        });
        multiplier -= 0.08;
      }

      // Experience requirements
      if (minExp >= 5) {
        multiplier += 0.18;
        factors.push({
          text: `${minExp}+ years experience required (+18% time)`,
          impact: "increase"
        });
      }

      // Strict CGPA
      if (minCgpa >= 8.5) {
        multiplier += 0.20;
        factors.push({
          text: `High CGPA threshold (≥ ${minCgpa}) narrows applicant pool (+20% time)`,
          impact: "increase"
        });
      }

      // College Tier
      if (collegeTier === "tier1") {
        multiplier += 0.25;
        factors.push({
          text: "Tier 1 college restriction (+25% time)",
          impact: "increase"
        });
      }

      // Remote vs On-site
      if (isRemote) {
        multiplier -= 0.20;
        factors.push({
          text: "Remote flexibility expands candidate reach (-20% time)",
          impact: "decrease"
        });
      }

      // Salary transparency
      if (salary && salary.visible && salary.min && salary.max) {
        multiplier -= 0.15;
        factors.push({
          text: "Transparent salary posted (-15% time, attracts faster applicants)",
          impact: "decrease"
        });
      } else {
        multiplier += 0.12;
        factors.push({
          text: "Undisclosed salary range (+12% time)",
          impact: "increase"
        });
      }

      const predictedDays = Math.max(7, Math.round(baselineDays * multiplier));

      return {
        predictedDays,
        confidence,
        sampleSize: totalEvaluated,
        unfilledRate,
        factors: factors.length > 0 ? factors : [{ text: "Standard market requirements", impact: "neutral" }]
      };
    } catch (err) {
      logger.error({ err: err.message }, "Error in predictTimeToFill");
      return {
        predictedDays: 32,
        confidence: "low",
        sampleSize: 0,
        unfilledRate: 15,
        factors: [{ text: "Estimated from industry average", impact: "neutral" }]
      };
    }
  }
}

module.exports = new TimeToFillService();
