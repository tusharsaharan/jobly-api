const logger = require("../config/logger");
const Evaluation = require("../models/Evaluation");
const InterviewSession = require("../models/InterviewSession");
const TimelineEvent = require("../models/TimelineEvent");
const CodeCheckpoint = require("../models/CodeCheckpoint");
const WhiteboardSnapshot = require("../models/WhiteboardSnapshot");

/**
 * Helper to verify recruiter permission for session
 */
async function authorizeRecruiter(sessionId, user) {
  const session = await InterviewSession.findById(sessionId)
    .populate("seeker", "name email")
    .populate("recruiter", "name email")
    .populate("job");

  if (!session) {
    const error = new Error("Interview session not found");
    error.status = 404;
    throw error;
  }

  const uid = String(user._id || user.id);
  const isRecruiter = String(session.recruiter?._id || session.recruiter) === uid;
  const isAdditional = (session.additionalInterviewers || []).some(
    (id) => String(id?._id || id) === uid
  );

  if (!isRecruiter && !isAdditional) {
    const error = new Error("Access denied. Only hiring recruiters can evaluate this session.");
    error.status = 403;
    throw error;
  }

  return session;
}

/**
 * Candidate feedback is deliberately a separate, reduced representation.  It
 * must never include the hiring team's private notes, AI internal assessment,
 * or raw evidence annotations.
 */
function toCandidateFeedback(evaluation) {
  return {
    overallRating: evaluation.overallRating,
    decision: evaluation.decision,
    strengths: evaluation.strengths || [],
    improvementAreas: evaluation.weaknesses || [],
    competencies: (evaluation.competencies || []).map((competency) => ({
      category: competency.category,
      score: competency.score,
      notes: competency.notes || "",
    })),
    completedAt: evaluation.updatedAt || evaluation.createdAt,
  };
}

async function authorizeCandidate(sessionId, user) {
  const session = await InterviewSession.findById(sessionId)
    .populate("job", "title company")
    .populate("recruiter", "name");

  if (!session) {
    const error = new Error("Interview session not found");
    error.status = 404;
    throw error;
  }

  if (String(session.seeker) !== String(user._id || user.id)) {
    const error = new Error("Access denied. Candidate feedback is only available to the interviewed candidate.");
    error.status = 403;
    throw error;
  }

  return session;
}

/**
 * POST /api/evaluations/:sessionId
 * Create structured evaluation scorecard with verified evidence links
 */
exports.createEvaluation = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const {
      overallRating,
      decision,
      competencies = [],
      strengths = [],
      weaknesses = [],
      privateNotes = "",
      aiInsights = null,
    } = req.body;

    if (!overallRating || !decision) {
      return res.status(400).json({ msg: "overallRating and decision are required." });
    }

    const session = await authorizeRecruiter(sessionId, req.user);

    // Validate evidence references
    for (const comp of competencies) {
      if (!comp.evidenceRefs || comp.evidenceRefs.length === 0) {
        return res.status(400).json({
          msg: `Competency '${comp.category}' must have at least one verifiable evidence reference attached.`,
        });
      }

      for (const ref of comp.evidenceRefs) {
        if (ref.timelineEventId) {
          const exists = await TimelineEvent.exists({
            _id: ref.timelineEventId,
            session: session._id,
          });
          if (!exists) {
            return res.status(400).json({
              msg: `Invalid evidence link: TimelineEvent ${ref.timelineEventId} not found in this session.`,
            });
          }
        }
        if (ref.checkpointId) {
          const exists = await CodeCheckpoint.exists({
            _id: ref.checkpointId,
            session: session._id,
          });
          if (!exists) {
            return res.status(400).json({
              msg: `Invalid evidence link: Checkpoint ${ref.checkpointId} not found in this session.`,
            });
          }
        }
      }
    }

    // Upsert evaluation record
    let evaluation = await Evaluation.findOne({ session: session._id });
    if (evaluation) {
      evaluation.overallRating = overallRating;
      evaluation.decision = decision;
      evaluation.competencies = competencies;
      evaluation.strengths = strengths;
      evaluation.weaknesses = weaknesses;
      evaluation.privateNotes = privateNotes;
      if (aiInsights) evaluation.aiInsights = aiInsights;
      await evaluation.save();
    } else {
      evaluation = await Evaluation.create({
        session: session._id,
        evaluator: req.user._id,
        overallRating,
        decision,
        competencies,
        strengths,
        weaknesses,
        privateNotes,
        aiInsights,
      });
    }

    // Auto-complete session if live or waiting
    if (session.status !== "COMPLETED") {
      session.status = "COMPLETED";
      session.stage = "COMPLETED";
      session.actualEnd = new Date();
      await session.save();
    }

    // Asynchronously extract candidate weaknesses into CandidateTopicWeakness
    const candidateId = session.seeker;
    if (candidateId && weaknesses && weaknesses.length > 0) {
      const topicExtractionService = require("../services/topicExtraction.service");
      topicExtractionService.processCandidateFeedback({
        candidateId,
        sourceType: "evaluation",
        sourceId: evaluation._id,
        sourceSessionId: session._id,
        feedback: weaknesses
      }).catch(err => logger.warn({ err: err.message }, "Async topic extraction failed"));
    }

    return res.status(201).json({
      msg: "Evaluation saved successfully with verified evidence.",
      evaluation,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error saving evaluation");
    return res.status(err.status || 500).json({ msg: err.message || "Failed saving evaluation" });
  }
};

/**
 * GET /api/evaluations/:sessionId
 * Fetch complete evaluation for session
 */
exports.getEvaluation = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await authorizeRecruiter(sessionId, req.user);

    const evaluation = await Evaluation.findOne({ session: session._id })
      .populate("evaluator", "name email")
      .lean();

    if (!evaluation) {
      return res.status(404).json({ msg: "Evaluation not found for this session." });
    }

    return res.json({ evaluation, session });
  } catch (err) {
    logger.error({ err: err.message }, "Error retrieving evaluation");
    return res.status(err.status || 500).json({ msg: err.message || "Failed retrieving evaluation" });
  }
};

/**
 * GET /api/evaluations/:sessionId/candidate-feedback
 * Candidate-safe outcome and coaching view. This endpoint intentionally does
 * not reuse getEvaluation, which is reserved for the hiring team.
 */
exports.getCandidateFeedback = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await authorizeCandidate(sessionId, req.user);
    const evaluation = await Evaluation.findOne({ session: session._id }).lean();

    if (!evaluation) {
      return res.status(404).json({ msg: "Feedback has not been published for this interview yet." });
    }

    return res.json({
      feedback: toCandidateFeedback(evaluation),
      session: {
        _id: session._id,
        title: session.title,
        job: session.job,
        recruiter: session.recruiter,
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error retrieving candidate feedback");
    return res.status(err.status || 500).json({ msg: err.message || "Failed retrieving candidate feedback" });
  }
};

/**
 * PUT /api/evaluations/:sessionId
 * Update existing evaluation
 */
exports.updateEvaluation = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await authorizeRecruiter(sessionId, req.user);

    const updated = await Evaluation.findOneAndUpdate(
      { session: session._id },
      { $set: req.body },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ msg: "Evaluation not found to update." });
    }

    return res.json({ msg: "Evaluation updated successfully", evaluation: updated });
  } catch (err) {
    logger.error({ err: err.message }, "Error updating evaluation");
    return res.status(err.status || 500).json({ msg: err.message || "Failed updating evaluation" });
  }
};

/**
 * GET /api/evaluations/:sessionId/evidence/:evidenceId
 * Resolve an evidence reference to its underlying artifact details
 */
exports.resolveEvidence = async (req, res) => {
  try {
    const { sessionId, evidenceId } = req.params;
    const session = await authorizeRecruiter(sessionId, req.user);

    const evaluation = await Evaluation.findOne({ session: session._id });
    if (!evaluation) {
      return res.status(404).json({ msg: "Evaluation not found" });
    }

    let foundRef = null;
    for (const comp of evaluation.competencies) {
      const match = comp.evidenceRefs.find((r) => String(r._id) === String(evidenceId));
      if (match) {
        foundRef = match;
        break;
      }
    }

    if (!foundRef) {
      return res.status(404).json({ msg: "Evidence reference not found" });
    }

    let artifact = null;
    if (foundRef.timelineEventId) {
      artifact = await TimelineEvent.findById(foundRef.timelineEventId);
    } else if (foundRef.checkpointId) {
      artifact = await CodeCheckpoint.findById(foundRef.checkpointId);
    } else if (foundRef.snapshotId) {
      artifact = await WhiteboardSnapshot.findById(foundRef.snapshotId);
    }

    return res.json({
      evidenceRef: foundRef,
      resolvedArtifact: artifact,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Error resolving evidence artifact");
    return res.status(err.status || 500).json({ msg: err.message || "Failed resolving evidence" });
  }
};
