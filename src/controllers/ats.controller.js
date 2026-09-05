const Application = require("../models/Application");
const Job = require("../models/Job");
const User = require("../models/User");
const AtsAnalysis = require("../models/AtsAnalysis");
const { scoreRoleFit } = require("../modules/ats");
const logger = require("../config/logger");

/**
 * Get detailed versioned ATS analysis for an application
 */
exports.getApplicationAnalysis = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const application = await Application.findById(applicationId).populate("job seeker");

    if (!application) {
      return res.status(404).json({ msg: "Application not found" });
    }

    // Authorization: only the applicant (seeker) or recruiter of the job can access
    const isApplicant = String(application.seeker._id || application.seeker) === String(req.user._id);
    const isRecruiter = String(application.recruiter._id || application.recruiter) === String(req.user._id);

    if (!isApplicant && !isRecruiter) {
      return res.status(403).json({ msg: "Not authorized to view this analysis" });
    }

    if (application.latestAtsAnalysis) {
      const existing = await AtsAnalysis.findById(application.latestAtsAnalysis).lean();
      if (existing) {
        return res.json({ analysis: existing });
      }
    }

    // Generate V2 analysis on the fly if not already persisted
    const seeker = await User.findById(application.seeker._id || application.seeker).select("-password");
    const job = application.job;

    const resumeProfile = seeker.resumeProfile || {
      schemaVersion: "resume-profile/1",
      source: {
        uploadId: "legacy-upl",
        fileName: "resume.pdf",
        mimeType: "application/pdf",
        sha256: "0".repeat(64),
        extractedAt: new Date().toISOString(),
        extractor: "fallback",
        extractionConfidence: 0.85,
      },
      skills: (seeker.skills || []).map((s) => ({
        canonicalId: `skill_${s.toLowerCase().replace(/\W+/g, "_")}`,
        label: s,
        aliasesObserved: [s],
        evidence: [{ section: "skills", quote: s }],
      })),
      experience: (seeker.experience || []).map((e) => ({
        title: e.title,
        organization: e.company,
        bullets: e.duration ? [e.duration] : [],
        skills: [],
        evidence: [{ section: "experience", quote: `${e.title} at ${e.company}` }],
      })),
      projects: [],
      education: [
        {
          qualification: seeker.degree || "Bachelor's Degree",
          institution: seeker.college || "University",
          evidence: [{ section: "education", quote: `${seeker.degree} from ${seeker.college}` }],
        },
      ],
      certifications: [],
      achievements: (seeker.achievements || []).map((a) => ({
        text: a,
        evidence: [{ section: "achievements", quote: a }],
      })),
      sectionsDetected: ["skills", "experience", "education"],
      parseWarnings: [],
    };

    const jobAtsProfile = {
      schemaVersion: "job-ats-profile/1",
      targetTitles: [job.title],
      mustHaveSkills: (job.skills || []).map((s) => ({
        canonicalId: `skill_${s.toLowerCase().replace(/\W+/g, "_")}`,
        label: s,
        required: true,
        weight: 4,
      })),
      preferredSkills: [],
      responsibilityPhrases: [],
      minimumExperienceYears: job.experienceYears || 0,
      requiredEducation: { degrees: [], fieldsOfStudy: [], required: false },
      certifications: [],
      keywords: [],
    };

    const analysis = scoreRoleFit({
      resumeProfile,
      jobAtsProfile,
      jobId: job._id.toString(),
      applicationId: application._id.toString(),
      resumeUploadId: "upload-generated",
      resumeHash: resumeProfile.source?.sha256 || "0".repeat(64),
    });

    const dbSession = await AtsAnalysis.db.startSession();
    dbSession.startTransaction();
    let savedAnalysis;
    try {
      [savedAnalysis] = await AtsAnalysis.create([{
        ...analysis,
        userId: seeker._id,
        jobId: job._id,
        applicationId: application._id,
      }], { session: dbSession });

      application.atsScore = analysis.overallScore;
      application.latestAtsAnalysis = savedAnalysis._id;
      application.atsVersion = "v2";
      await application.save({ session: dbSession });

      await dbSession.commitTransaction();
    } catch (txnErr) {
      await dbSession.abortTransaction();
      throw txnErr;
    } finally {
      dbSession.endSession();
    }

    return res.json({ analysis: savedAnalysis });
  } catch (err) {
    logger.error({ err: err.message }, "getApplicationAnalysis error");
    return res.status(500).json({ msg: "Failed to fetch ATS analysis" });
  }
};

/**
 * Calculate job fit match for candidate before or after applying
 */
exports.calculateJobFit = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ msg: "Job not found" });
    }

    const user = await User.findById(req.user._id).select("-password");
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    if (!user.resumeProfile && (!user.skills || user.skills.length === 0)) {
      return res.status(400).json({ msg: "Please upload your resume first to compute job fit match." });
    }

    const resumeProfile = user.resumeProfile || {
      schemaVersion: "resume-profile/1",
      source: {
        uploadId: "calc-upl",
        fileName: "resume.pdf",
        mimeType: "application/pdf",
        sha256: "0".repeat(64),
        extractedAt: new Date().toISOString(),
        extractor: "fallback",
        extractionConfidence: 0.85,
      },
      skills: (user.skills || []).map((s) => ({
        canonicalId: `skill_${s.toLowerCase().replace(/\W+/g, "_")}`,
        label: s,
        aliasesObserved: [s],
        evidence: [{ section: "skills", quote: s }],
      })),
      experience: (user.experience || []).map((e) => ({
        title: e.title,
        organization: e.company,
        bullets: e.duration ? [e.duration] : [],
        skills: [],
        evidence: [{ section: "experience", quote: `${e.title} at ${e.company}` }],
      })),
      projects: [],
      education: [
        {
          qualification: user.degree || "Bachelor's Degree",
          institution: user.college || "University",
          evidence: [{ section: "education", quote: `${user.degree} from ${user.college}` }],
        },
      ],
      certifications: [],
      achievements: (user.achievements || []).map((a) => ({
        text: a,
        evidence: [{ section: "achievements", quote: a }],
      })),
      sectionsDetected: ["skills", "experience", "education"],
      parseWarnings: [],
    };

    const jobAtsProfile = {
      schemaVersion: "job-ats-profile/1",
      targetTitles: [job.title],
      mustHaveSkills: (job.skills || []).map((s) => ({
        canonicalId: `skill_${s.toLowerCase().replace(/\W+/g, "_")}`,
        label: s,
        required: true,
        weight: 4,
      })),
      preferredSkills: [],
      responsibilityPhrases: [],
      minimumExperienceYears: job.experienceYears || 0,
      requiredEducation: { degrees: [], fieldsOfStudy: [], required: false },
      certifications: [],
      keywords: [],
    };

    const analysis = scoreRoleFit({
      resumeProfile,
      jobAtsProfile,
      jobId: job._id.toString(),
      resumeUploadId: "calc-run",
      resumeHash: resumeProfile.source?.sha256 || "0".repeat(64),
    });

    return res.json({ analysis });
  } catch (err) {
    logger.error({ err: err.message }, "calculateJobFit error");
    return res.status(500).json({ msg: "Failed to calculate job fit" });
  }
};
