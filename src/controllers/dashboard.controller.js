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
      return {
        ...s,
        evaluation: isRecruiter ? evaluation : toCandidateEvaluationSummary(evaluation),
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
