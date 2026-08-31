const pdfParse = require("pdf-parse");
const crypto = require("crypto");
const User = require("../models/User");
const Application = require("../models/Application");
const ResumeUpload = require("../models/ResumeUpload");
const AtsAnalysis = require("../models/AtsAnalysis");
const aiService = require("../modules/ai/aiService");
const { computeAtsScore } = require("../services/ai.service");
const { scoreRoleFit, scoreResumeHealth, extractSkillsFromText, createEvidenceRef } = require("../modules/ats");
const { normalizeSkills } = require("../utils/jobLogic");
const logger = require("../config/logger");
const sseManager = require("../infrastructure/events/sse.manager");
const { publishDomainEvent } = require("../infrastructure/events/domainEvents");
const { resumeProcessingDurationSeconds } = require("../infrastructure/observability/metrics");
const { getFileStream } = require("../config/s3");

async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function cleanText(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function normalizeCgpa(value) {
  const cgpa = Number(value);
  return Number.isFinite(cgpa) && cgpa >= 0 && cgpa <= 10 ? cgpa : null;
}

function normalizeCollegeTier(value) {
  return ["tier1", "tier2", "tier3", "unknown"].includes(String(value || "").toLowerCase())
    ? String(value).toLowerCase()
    : "unknown";
}

function normalizeTextList(value, limit, itemLimit) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item) => cleanText(item, itemLimit))
    .filter((item) => {
      const key = item.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function normalizeExperience(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      title: cleanText(entry?.title, 160),
      company: cleanText(entry?.company, 160),
      duration: cleanText(entry?.duration, 100),
    }))
    .filter((entry) => entry.title || entry.company || entry.duration)
    .slice(0, 30);
}

async function processResumeJob(jobData) {
  const { userId, fileBuffer, s3Key, originalName, uploadId } = jobData;
  const startTime = Date.now();
  logger.info({ userId, originalName, uploadId }, "Starting async resume processing pipeline");

  // Step 1: Notify client of scanning & text extraction
  sseManager.sendToUser(userId, "resume.status", {
    step: "scanning",
    message: "Scanning and extracting text from PDF document...",
    progress: 20,
  });

  if (uploadId) {
    await ResumeUpload.findOneAndUpdate(
      { uploadId },
      { state: "text_extracting", progress: 20, messageCode: "text_extracting" }
    ).catch(() => {});
  }

  let text = "";
  let sha256 = null;
  let pdfParseError = null;
  try {
    let buffer = fileBuffer ? Buffer.from(fileBuffer, "base64") : null;
    if (!buffer && s3Key) {
      try {
        const stream = await getFileStream(s3Key);
        buffer = await streamToBuffer(stream);
      } catch (s3Err) {
        logger.error({ err: s3Err.message, userId, s3Key }, "S3 fetch failed - no fallback zeros");
        throw new Error(`S3 fetch failed: ${s3Err.message}`);
      }
    }

    if (!buffer) {
      throw new Error("No file buffer available and S3 fetch failed");
    }

    // Always compute real sha256, never store "0"*64
    sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    // Properly parse PDF; distinguish encrypted vs image-only
    try {
      const parsedData = await pdfParse(buffer);
      text = parsedData.text || "";
    } catch (parseErr) {
      pdfParseError = parseErr;
      if (/encrypt|password|encrypted/i.test(parseErr.message)) {
        logger.error({ err: parseErr.message, userId }, "Encrypted PDF detected");
        sseManager.sendToUser(userId, "resume.failed", {
          error: "Encrypted PDF is not supported. Please upload an unprotected PDF.",
        });
        if (uploadId) {
          await ResumeUpload.findOneAndUpdate(
            { uploadId },
            { state: "failed", errorMessage: "Encrypted PDF not supported", progress: 100 }
          ).catch(() => {});
        }
        return { success: false, error: "Encrypted PDF not supported. Please upload an unprotected PDF." };
      }
      logger.error({ err: parseErr.message, userId }, "PDF parse failed - likely image-only scanned PDF");
      text = "";
    }
  } catch (err) {
    // If already handled encrypted case, it would have returned
    if (!pdfParseError || !/encrypt|password|encrypted/i.test(pdfParseError.message)) {
      logger.error({ err: err.message, userId }, "PDF text extraction failed");
    }
    // Ensure we do not proceed with zero hash; if sha256 still null, we will fail below as image-only/empty
    if (!text) text = "";
  }

  // Ensure sha256 is valid hex (never "0"*64); if still null, generate from text fallback only if text exists else fail
  if (!sha256) {
    if (text && text.trim().length >= 30) {
      sha256 = crypto.createHash("sha256").update(Buffer.from(text)).digest("hex");
    } else {
      // No buffer hash available and text empty -> fail rather than storing zeros
      sseManager.sendToUser(userId, "resume.failed", {
        error: "Failed to process PDF - could not compute file hash and no extractable text",
      });
      if (uploadId) {
        await ResumeUpload.findOneAndUpdate(
          { uploadId },
          { state: "failed", errorMessage: "Missing file buffer and S3 failure", progress: 100 }
        ).catch(() => {});
      }
      return { success: false, error: "Missing file buffer and S3 failure" };
    }
  }

  if (!text || text.trim().length < 30) {
    const isEncrypted = pdfParseError && /encrypt|password|encrypted/i.test(pdfParseError.message);
    const errorMsg = isEncrypted
      ? "Encrypted PDF is not supported. Please upload an unprotected PDF."
      : "Could not extract readable text from PDF. Ensure the file is not scanned/image-based.";
    sseManager.sendToUser(userId, "resume.failed", {
      error: errorMsg,
    });
    if (uploadId) {
      await ResumeUpload.findOneAndUpdate(
        { uploadId },
        { state: "failed", errorMessage: isEncrypted ? "Encrypted PDF not supported" : "Empty or unreadable text - possibly image-only scanned PDF", progress: 100 }
      ).catch(() => {});
    }
    return { success: false, error: isEncrypted ? "Encrypted PDF not supported" : "Text extraction empty - possibly image-only scanned PDF" };
  }

  // Step 2: AI Parsing & Structured Extraction
  sseManager.sendToUser(userId, "resume.status", {
    step: "profile_extracting",
    message: "AI extracting canonical skills, experience, and evidence...",
    progress: 45,
  });
  if (uploadId) {
    await ResumeUpload.findOneAndUpdate(
      { uploadId },
      { state: "profile_extracting", progress: 45, messageCode: "profile_extracting" }
    ).catch(() => {});
  }

  const parsed = await aiService.parseResume(text);
  const education = parsed && typeof parsed.education === "object" ? parsed.education : {};

  // Extract canonical skills from text & AI output
  const extractedSkills = extractSkillsFromText(text);
  const skillEntries = extractedSkills.map((s) => ({
    canonicalId: s.canonicalId,
    label: s.label,
    aliasesObserved: [s.matchedAlias],
    evidence: [createEvidenceRef("skills", `${s.label} mentioned in resume`)],
  }));

  // Build canonical ResumeProfile
  const resumeProfile = {
    schemaVersion: "resume-profile/1",
    source: {
      uploadId: uploadId || `upl-${Date.now()}`,
      fileName: originalName || "resume.pdf",
      mimeType: "application/pdf",
      sha256,
      extractedAt: new Date().toISOString(),
      extractor: "gemini",
      extractionConfidence: 0.92,
    },
    contact: {
      email: cleanText(parsed?.contact?.email || parsed?.email, 100) || null,
      phone: cleanText(parsed?.contact?.phone || parsed?.phone, 50) || null,
      location: cleanText(parsed?.contact?.location || parsed?.location, 100) || null,
      links: [],
    },
    headline: cleanText(parsed?.headline || parsed?.title, 200) || null,
    summary: cleanText(parsed?.summary, 2000) || null,
    skills: skillEntries.length > 0 ? skillEntries : normalizeSkills(parsed?.skills).map((s) => ({
      canonicalId: `skill_${s.toLowerCase().replace(/\W+/g, "_")}`,
      label: s,
      aliasesObserved: [s],
      evidence: [createEvidenceRef("skills", s)],
    })),
    experience: normalizeExperience(parsed?.experience).map((e) => ({
      title: e.title || "Software Engineer",
      organization: e.company || "Company",
      startDate: null,
      endDate: null,
      isCurrent: false,
      location: null,
      bullets: e.duration ? [e.duration] : [],
      skills: [],
      evidence: [createEvidenceRef("experience", `${e.title} at ${e.company}`)],
    })),
    projects: (Array.isArray(parsed?.projects) ? parsed.projects : []).map((p) => ({
      name: typeof p === "string" ? p : (p.name || "Project"),
      description: typeof p === "string" ? p : (p.description || null),
      bullets: [],
      links: [],
      skills: [],
      evidence: [createEvidenceRef("projects", typeof p === "string" ? p : p.name)],
    })),
    education: [
      {
        qualification: cleanText(education.degree, 160) || "Bachelor's Degree",
        fieldOfStudy: null,
        institution: cleanText(education.college, 160) || "University",
        startDate: null,
        endDate: null,
        gpa: normalizeCgpa(education.cgpa),
        gpaScale: 10,
        evidence: [createEvidenceRef("education", `${education.degree} from ${education.college}`)],
      },
    ],
    certifications: [],
    achievements: normalizeTextList(parsed?.achievements, 20, 300).map((a) => ({
      text: a,
      quantifiedOutcome: null,
      evidence: [createEvidenceRef("achievements", a)],
    })),
    sectionsDetected: ["contact", "summary", "skills", "experience", "education"],
    parseWarnings: [],
  };

  // Step 3: Pre-application Resume Health Score
  sseManager.sendToUser(userId, "resume.status", {
    step: "health_analyzing",
    message: "Analyzing resume health, structure, and impact...",
    progress: 70,
  });
  if (uploadId) {
    await ResumeUpload.findOneAndUpdate(
      { uploadId },
      { state: "health_analyzing", progress: 70, messageCode: "health_analyzing" }
    ).catch(() => {});
  }

  const healthResult = scoreResumeHealth(resumeProfile);

  const updateData = {
    skills: normalizeSkills(parsed?.skills),
    resumeText: text,
    resumeSummary: cleanText(parsed?.summary, 2000),
    degree: cleanText(education.degree, 160),
    cgpa: normalizeCgpa(education.cgpa),
    college: cleanText(education.college, 160),
    collegeTier: normalizeCollegeTier(education.tier),
    achievements: normalizeTextList(parsed?.achievements, 20, 300),
    experience: normalizeExperience(parsed?.experience),
    resumeProfile,
    resumeHealth: healthResult,
  };

  // Step 4: Persist to MongoDB
  sseManager.sendToUser(userId, "resume.status", {
    step: "persisting",
    message: "Saving candidate profile & health analysis...",
    progress: 85,
  });

  const user = await User.findByIdAndUpdate(userId, updateData, { new: true, runValidators: true });
  if (!user) {
    return { success: false, error: "User not found" };
  }

  // Step 5: Refresh ATS V2 scores on existing applications in parallel
  const applications = await Application.find({ seeker: user._id }).populate("job");
  await Promise.allSettled(
    applications.map(async (app) => {
      if (!app.job) return;
      try {
        const jobAtsProfile = {
          schemaVersion: "job-ats-profile/1",
          targetTitles: [app.job.title],
          mustHaveSkills: (app.job.skills || []).map((s) => ({
            canonicalId: `skill_${s.toLowerCase().replace(/\W+/g, "_")}`,
            label: s,
            required: true,
            weight: 4,
          })),
          preferredSkills: [],
          responsibilityPhrases: [],
          minimumExperienceYears: app.job.experienceYears || 0,
          requiredEducation: { degrees: [], fieldsOfStudy: [], required: false },
          certifications: [],
          keywords: [],
        };

        const analysis = scoreRoleFit({
          resumeProfile,
          jobAtsProfile,
          jobId: app.job._id.toString(),
          applicationId: app._id.toString(),
          resumeUploadId: uploadId || "upload-legacy",
          resumeHash: sha256,
        });

        const savedAnalysis = await AtsAnalysis.create({
          ...analysis,
          userId: user._id,
          jobId: app.job._id,
          applicationId: app._id,
        });

        app.atsScore = analysis.overallScore;
        app.latestAtsAnalysis = savedAnalysis._id;
        app.atsVersion = "v2";
        await app.save();
      } catch (err) {
        logger.warn({ err: err.message, appId: app._id }, "Failed to score application with ATS V2");
      }
    })
  );

  // Update ResumeUpload to completed
  if (uploadId) {
    await ResumeUpload.findOneAndUpdate(
      { uploadId },
      {
        state: "completed",
        progress: 100,
        messageCode: "completed",
        resumeProfile,
        healthScore: healthResult.score,
        healthAnalysis: healthResult,
      }
    ).catch(() => {});
  }

  // Step 6: Publish domain events & notify client
  const durationSec = (Date.now() - startTime) / 1000;
  resumeProcessingDurationSeconds.labels("success", "gemini").observe(durationSec);

  await publishDomainEvent("resume.processed", {
    userId: String(user._id),
    skillsCount: updateData.skills.length,
    durationSec,
  });

  sseManager.sendToUser(userId, "resume.completed", {
    step: "completed",
    message: "Resume parsing and health check complete!",
    progress: 100,
    healthScore: healthResult.score,
    healthAnalysis: healthResult,
    profile: resumeProfile,
  });

  logger.info({ userId, durationSec, healthScore: healthResult.score }, "Resume processing pipeline finished successfully");
  return { success: true, user, resumeProfile, healthResult };
}

module.exports = {
  processResumeJob,
};

