const logger = require("../config/logger");
const Evaluation = require("../models/Evaluation");
const InterviewSession = require("../models/InterviewSession");
const TimelineEvent = require("../models/TimelineEvent");
const CodeCheckpoint = require("../models/CodeCheckpoint");
const WhiteboardSnapshot = require("../models/WhiteboardSnapshot");
const { createEvidenceReference, computeVerificationHash } = require("../modules/signals/evidenceEngine");

/**
 * Helper to verify recruiter permission for session
 */
async function authorizeRecruiter(sessionId, user) {
  const tenantFilter = user?.tenantId ? { tenantId: user.tenantId } : {};
  const session = await InterviewSession.findOne({ _id: sessionId, ...tenantFilter })
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
  const tenantFilter = user?.tenantId ? { tenantId: user.tenantId } : {};
  const session = await InterviewSession.findOne({ _id: sessionId, ...tenantFilter })
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

    // Authorize first to ensure 403 for non-recruiters even if payload invalid (test expects 403)
    const session = await authorizeRecruiter(sessionId, req.user);

    if (!overallRating || !decision) {
      return res.status(400).json({ msg: "overallRating and decision are required." });
    }
    if (!Array.isArray(competencies) || competencies.length === 0) {
      return res.status(400).json({ msg: "At least one competency with evidence is required." });
    }

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

    // Upsert evaluation record — per-evaluator unique, prevents overwrite across interviewers
    let evaluation;
    try {
      evaluation = await Evaluation.findOneAndUpdate(
        { session: session._id, evaluator: req.user._id },
        {
          $set: {
            overallRating,
            decision,
            competencies,
            strengths,
            weaknesses,
            privateNotes,
            ...(aiInsights ? { aiInsights } : {}),
            evaluator: req.user._id,
          },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
    } catch (upsertErr) {
      // Fallback for duplicate key race: retry with findOneAndUpdate
      if (upsertErr.code === 11000) {
        evaluation = await Evaluation.findOneAndUpdate(
          { session: session._id, evaluator: req.user._id },
          {
            $set: {
              overallRating,
              decision,
              competencies,
              strengths,
              weaknesses,
              privateNotes,
              ...(aiInsights ? { aiInsights } : {}),
              evaluator: req.user._id,
            },
          },
          { new: true, runValidators: true }
        );
      } else {
        throw upsertErr;
      }
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

    const { overallRating, decision, competencies, feedback } = req.body;
    // Validate competencies if provided — must have evidence, must reference existing timeline events
    if (competencies !== undefined) {
      if (!Array.isArray(competencies) || competencies.length === 0) {
        return res.status(400).json({ msg: "competencies must be non-empty array with evidence" });
      }
      for (const comp of competencies) {
        if (!comp.evidenceRefs || comp.evidenceRefs.length === 0) {
          return res.status(400).json({ msg: `Competency '${comp.category || comp.pillar}' must have at least one evidence reference` });
        }
        for (const ref of comp.evidenceRefs) {
          if (ref.timelineEventId) {
            const exists = await TimelineEvent.exists({ _id: ref.timelineEventId, session: session._id });
            if (!exists) return res.status(400).json({ msg: `Invalid evidence link: TimelineEvent ${ref.timelineEventId} not found` });
          }
        }
      }
    }
    const updatePayload = {};
    if (overallRating !== undefined) updatePayload.overallRating = overallRating;
    if (decision !== undefined) updatePayload.decision = decision;
    if (competencies !== undefined) updatePayload.competencies = competencies;
    if (feedback !== undefined) updatePayload.feedback = feedback;

    const updated = await Evaluation.findOneAndUpdate(
      { session: session._id, evaluator: req.user._id },
      { $set: updatePayload },
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
 * POST /api/evaluations/:sessionId/competencies
 * Strict 4-pillar competency submission with evidence — plan hierarchy Phase 5
 */
exports.createCompetencyEvaluation = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { competencies, overallRating, decision, strengths, weaknesses, privateNotes } = req.body;

    if (!competencies || !Array.isArray(competencies)) {
      return res.status(400).json({ msg: "competencies array (4 pillars) is required" });
    }

    // Validate against canonical Signal contracts
    let contractModule = null;
    try {
      contractModule = require("@jobly/contracts");
    } catch {}
    if (contractModule?.CompetencyRatingSchema) {
      const arrSchema = contractModule.CompetencyRatingSchema.array().min(4).max(4);
      const parsed = arrSchema.safeParse(competencies);
      if (!parsed.success) {
        return res.status(400).json({ msg: "Invalid competency payload", errors: parsed.error.issues });
      }
      // Enforce deterministic engine version if provided
      if (req.body.schemaVersion && req.body.schemaVersion !== contractModule.SIGNAL_ENGINE_VERSION) {
        return res.status(400).json({ msg: `schemaVersion must be ${contractModule.SIGNAL_ENGINE_VERSION}` });
      }
    }

    // Map contract pillars to Evaluation storage (preserve pillar enum) — generate real verificationHash via evidenceEngine
    const mappedCompetencies = competencies.map((c) => ({
      category: c.pillar ? String(c.pillar) : String(c.category || "unknown"),
      score: c.score,
      notes: c.rationale || c.notes || "",
      evidenceRefs: (c.evidenceReferences || c.evidenceRefs || []).map((er) => {
        const refType = er.type || er.refType || "TIMELINE_EVENT";
        const timelineEventId = er.timelineEventId || er.timelineEvent || null;
        const checkpointId = er.checkpointId || null;
        const snapshotId = er.snapshotId || null;
        const quote = er.locator?.quote || er.quote || null;
        const note = er.summary || er.note || "";
        const offsetMs = Number.isFinite(Number(er.offsetMs)) ? Math.max(0, Math.floor(Number(er.offsetMs))) : 0;
        // Build clean locator for hash computation (mirrors evidenceEngine cleanLocator)
        const locatorForHash = {};
        if (er.locator?.file || er.file) locatorForHash.file = er.locator?.file || er.file;
        if (quote) locatorForHash.quote = String(quote).slice(0, 500);
        if (er.locator?.speaker) locatorForHash.speaker = er.locator.speaker;
        if (er.locator?.startLine != null) locatorForHash.startLine = Number(er.locator.startLine);
        if (er.locator?.endLine != null) locatorForHash.endLine = Number(er.locator.endLine);
        if (er.locator?.snapshotVersion != null) locatorForHash.snapshotVersion = er.locator.snapshotVersion;
        if (er.locator?.testCaseIndex != null) locatorForHash.testCaseIndex = er.locator.testCaseIndex;
        if (er.locator?.eventType) locatorForHash.eventType = er.locator.eventType;
        let verificationHash = er.verificationHash;
        const isPlaceholder = !verificationHash || String(verificationHash).startsWith("pending-server-hash") || verificationHash === "fallbackhash12345678" || String(verificationHash).startsWith("pending");
        if (isPlaceholder) {
          try {
            if (timelineEventId) {
              const ref = createEvidenceReference({
                type: refType,
                timelineEventId: String(timelineEventId),
                offsetMs,
                locator: locatorForHash,
                summary: note || "Evidence",
              });
              verificationHash = ref.verificationHash;
            } else {
              verificationHash = computeVerificationHash(refType, offsetMs, locatorForHash, note || "Evidence");
            }
          } catch (_) {
            verificationHash = computeVerificationHash(refType, offsetMs, locatorForHash, note || "Evidence");
          }
        }
        return {
          refType,
          timelineEventId,
          checkpointId,
          snapshotId,
          quote,
          note,
          offsetMs,
          verificationHash,
        };
      }),
      pillar: c.pillar,
      confidence: c.confidence,
      signalsObserved: c.signalsObserved || [],
    }));

    // Delegate to existing createEvaluation logic
    req.body.competencies = mappedCompetencies;
    if (!req.body.overallRating && overallRating === undefined) {
      // Derive overallRating from average pillar score (1-5)
      const avg = mappedCompetencies.reduce((s, x) => s + (x.score || 3), 0) / mappedCompetencies.length;
      req.body.overallRating = Math.max(1, Math.min(5, Math.round(avg)));
    }
    if (!req.body.decision && decision === undefined) {
      req.body.decision = "HIRE";
    }
    if (strengths) req.body.strengths = strengths;
    if (weaknesses) req.body.weaknesses = weaknesses;
    if (privateNotes !== undefined) req.body.privateNotes = privateNotes;

    return exports.createEvaluation(req, res);
  } catch (err) {
    logger.error({ err: err.message }, "Error in competency evaluation");
    return res.status(err.status || 500).json({ msg: err.message || "Failed competency evaluation" });
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
