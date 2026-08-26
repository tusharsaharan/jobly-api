const logger = require("../config/logger");
const InterviewSession = require("../models/InterviewSession");
const Evaluation = require("../models/Evaluation");
const Application = require("../models/Application");

function toCandidateEvaluationSummary(evaluation) {
  if (!evaluation) return null;
  return {
    overallRating: evaluation.overallRating,
    decision: evaluation.decision,
    feedbackAvailable: true,
  };
}

/**
 * GET /api/dashboard/stats
 * Aggregated analytics for recruiter interview pipeline
 */
exports.getRecruiterStats = async (req, res) => {
  try {
    const isRecruiter = req.user.role === "recruiter";
    const userFilter = isRecruiter ? { recruiter: req.user._id } : { seeker: req.user._id };

    const [totalSessions, completedSessions, liveSessions, scheduledSessions] = await Promise.all([
      InterviewSession.countDocuments(userFilter),
      InterviewSession.countDocuments({ ...userFilter, status: "COMPLETED" }),
      InterviewSession.countDocuments({ ...userFilter, status: { $in: ["LIVE", "WAITING_ROOM"] } }),
      InterviewSession.countDocuments({ ...userFilter, status: "SCHEDULED" }),
    ]);

    // Decision breakdown for evaluated interviews
    const evaluations = await Evaluation.find().lean();
    const decisionsCount = {
      STRONG_HIRE: 0,
      HIRE: 0,
      NO_HIRE: 0,
      STRONG_NO_HIRE: 0,
      PENDING: 0,
    };

    evaluations.forEach((ev) => {
      if (decisionsCount[ev.decision] !== undefined) {
        decisionsCount[ev.decision]++;
      }
    });

    return res.json({
      totalSessions,
      completedSessions,
      liveSessions,
      scheduledSessions,
      decisionsCount,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error calculating recruiter stats");
    return res.status(500).json({ msg: "Failed fetching dashboard stats" });
  }
};

/**
 * GET /api/dashboard/interviews
 * Query all user interviews with associated evaluation scorecards
 */
exports.getDashboardInterviews = async (req, res) => {
  try {
    const { status, search } = req.query;
    const isRecruiter = req.user.role === "recruiter";
    const query = isRecruiter ? { recruiter: req.user._id } : { seeker: req.user._id };

    if (status && status !== "ALL") {
      query.status = status;
    }

    const sessions = await InterviewSession.find(query)
      .populate("job", "title company location type")
      .populate("seeker", "name email role")
      .populate("recruiter", "name email role")
      .sort({ scheduledStart: -1 })
      .lean();

    // Attach evaluation scorecards if available
    const sessionIds = sessions.map((s) => s._id);
    const evaluations = await Evaluation.find({ session: { $in: sessionIds } }).lean();
    const evalMap = new Map();
    evaluations.forEach((ev) => {
      evalMap.set(ev.session.toString(), ev);
    });

    const enriched = sessions.map((s) => {
      const evaluation = evalMap.get(s._id.toString()) || null;
      const isCompleted = s.status === "COMPLETED";
      const isLiveOrScheduled = ["LIVE", "WAITING_ROOM", "SCHEDULED"].includes(s.status);

      return {
        ...s,
        evaluation: isRecruiter ? evaluation : toCandidateEvaluationSummary(evaluation),
        capabilities: {
          canEnterRoom: isLiveOrScheduled,
          canReplay: isCompleted,
          canViewReview: isRecruiter && isCompleted,
          canViewFeedback: !isRecruiter && isCompleted && Boolean(evaluation),
          canEvaluate: isRecruiter && isCompleted,
        },
      };
    });

    return res.json({
      interviews: enriched,
      count: enriched.length,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error retrieving dashboard interviews");
    return res.status(500).json({ msg: "Failed retrieving dashboard interviews" });
  }
};

/**
 * GET /api/dashboard/leaderboard
 * Aggregated velocity and quality rankings for recruiters
 */
exports.getRecruiterLeaderboard = async (req, res) => {
  try {
    const User = require("../models/User");
    const Job = require("../models/Job");
    const Application = require("../models/Application");

    const recruiters = await User.find({ role: "recruiter" }).select("name email createdAt").lean();

    const leaderboard = await Promise.all(
      recruiters.map(async (rec) => {
        const jobs = await Job.find({ recruiter: rec._id }).lean();
        const filledJobs = jobs.filter((j) => j.closureReason === "filled");
        const activeJobs = jobs.filter((j) => j.status === "open");

        const applications = await Application.find({ recruiter: rec._id }).lean();
        const shortlisted = applications.filter((a) => a.status === "shortlisted");

        // Calculate average fill duration
        let totalFillDays = 0;
        let countedFills = 0;
        for (const fj of filledJobs) {
          if (fj.closedAt) {
            const days = Math.max(1, Math.round((new Date(fj.closedAt) - new Date(fj.createdAt)) / (1000 * 60 * 60 * 24)));
            totalFillDays += days;
            countedFills++;
          }
        }
        const avgTimeToFill = countedFills > 0 ? Math.round(totalFillDays / countedFills) : 24;

        // Calculate average candidate ATS score
        const atsScores = applications.filter((a) => typeof a.atsScore === "number").map((a) => a.atsScore);
        const avgAtsScore = atsScores.length > 0
          ? Math.round(atsScores.reduce((a, b) => a + b, 0) / atsScores.length)
          : 78;

        const badges = [];
        if (avgTimeToFill <= 20) badges.push({ name: "Velocity Leader", description: "Sub-20 day average fill time" });
        if (avgAtsScore >= 80) badges.push({ name: "High Match Quality", description: "Top tier ATS candidate profile index" });
        if (jobs.length >= 5) badges.push({ name: "Active Publisher", description: "Consistent hiring pipeline" });

        return {
          id: rec._id,
          name: rec.name,
          totalPostings: jobs.length,
          activePostings: activeJobs.length,
          completedHires: filledJobs.length,
          totalApplicants: applications.length,
          shortlistedCount: shortlisted.length,
          avgTimeToFillDays: avgTimeToFill,
          avgCandidateAts: avgAtsScore,
          badges,
          score: (filledJobs.length * 15) + (shortlisted.length * 5) + (jobs.length * 2) + Math.max(0, 100 - avgTimeToFill)
        };
      })
    );

    leaderboard.sort((a, b) => b.score - a.score);

    res.json({
      leaderboard: leaderboard.slice(0, 10),
      currentRecruiterRank: leaderboard.findIndex((r) => r.id.toString() === req.user._id.toString()) + 1 || 1,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error calculating leaderboard");
    res.status(500).json({ msg: "Failed calculating recruiter leaderboard" });
  }
};
