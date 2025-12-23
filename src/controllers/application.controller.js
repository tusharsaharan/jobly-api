const mongoose = require("mongoose");
const Application = require("../models/Application");
const Job = require("../models/Job");
const ai = require("../services/ai.service");
const { meetsAtsRequirements } = require("../utils/jobLogic");

exports.applyToJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ msg: "Invalid job ID format" });
    }

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ msg: "Job not found" });
    }

    if (!job.recruiter) {
      return res.status(409).json({ msg: "This role is unavailable because its recruiter is no longer linked." });
    }

    if (String(job.recruiter) === String(req.user._id)) {
      return res.status(400).json({ msg: "Cannot apply to your own job" });
    }

    if (!req.user.resumeText) {
      return res.status(400).json({ msg: "Please upload your resume before applying." });
    }

    if (!meetsAtsRequirements(job, req.user)) {
      return res.status(403).json({ msg: "Your profile does not meet this role's required criteria." });
    }

    const atsResult = await ai.computeAtsScore(
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
      job.atsRequirements,
    );

    const application = await Application.create({
      job: job._id,
      seeker: req.user._id,
      recruiter: job.recruiter,
      atsScore: atsResult.score,
      atsBreakdown: atsResult.breakdown,
      atsTips: atsResult.tips
    });

    await application.populate("job");
    res.json(application);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ msg: "You have already applied to this job." });
    }
    console.error(error);
    res.status(500).json({ msg: "Failed to apply" });
  }
};

exports.getMyApplications = async (req, res) => {
  try {
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    let query = Application.find({ seeker: req.user._id })
      .populate("job")
      .sort({ createdAt: -1 })
      .lean();

    if (hasPagination) {
      query = query.skip((page - 1) * limit).limit(limit);
    }

    const applications = await query;
    res.json(applications);
  } catch (error) {
    logger.error({ err: error.message }, "Failed to fetch applications");
    res.status(500).json({ msg: "Failed to fetch applications" });
  }
};

exports.getApplicantsForRecruiter = async (req, res) => {
  try {
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    let query = Application.find({ recruiter: req.user._id })
      .populate("job")
      .populate("seeker", "name email skills cgpa college collegeTier degree achievements experience")
      .sort({ createdAt: -1 })
      .lean();

    if (hasPagination) {
      query = query.skip((page - 1) * limit).limit(limit);
    }

    const applications = await query;
    res.json(applications);
  } catch (error) {
    logger.error({ err: error.message }, "Failed to fetch applicants");
    res.status(500).json({ msg: "Failed to fetch applicants" });
  }
};

exports.updateApplicationStatus = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
      return res.status(400).json({ msg: "Invalid application ID format" });
    }

    if (!["applied", "shortlisted", "rejected"].includes(status)) {
      return res.status(400).json({ msg: "Invalid status" });
    }

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({ msg: "Application not found" });
    }

    if (String(application.recruiter) !== String(req.user._id)) {
      return res.status(403).json({ msg: "Forbidden" });
    }
    application.status = status;
    await application.save();

    res.json(application);
  } catch (error) {
    logger.error({ err: error.message }, "Failed to update status");
    res.status(500).json({ msg: "Failed to update status" });
  }
};
