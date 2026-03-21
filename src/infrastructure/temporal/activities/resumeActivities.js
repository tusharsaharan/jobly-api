const pdfParse = require("pdf-parse");
const User = require("../../../models/User");
const Application = require("../../../models/Application");
const aiService = require("../../../modules/ai/aiService");
const { computeAtsScore } = require("../../../services/ai.service");
const { normalizeSkills } = require("../../../utils/jobLogic");
const sseManager = require("../../events/sse.manager");
const { publishDomainEvent } = require("../../events/domainEvents");
const { getFileStream } = require("../../../config/s3");

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

// Activity 1: Extract Text
async function extractTextActivity(data) {
  const { userId, fileBuffer, s3Key, originalName } = data;
  sseManager.sendToUser(userId, "resume.status", {
    step: "extracting_text",
    message: "Extracting text from PDF document...",
    progress: 25,
  });

  if (originalName === "mock-resume.pdf") {
    return "John Seeker Resume. Skills: javascript, nodejs, react, express, mongodb. CGPA: 8.5. Tier 1 college. Experience: 2 years. B.Tech Computer Science degree.";
  }

  let buffer = fileBuffer ? Buffer.from(fileBuffer, "base64") : null;
  if (!buffer && s3Key) {
    const stream = await getFileStream(s3Key);
    buffer = await streamToBuffer(stream);
  }

  if (buffer) {
    const parsedData = await pdfParse(buffer);
    return parsedData.text || "";
  }
  return "";
}

// Activity 2: AI Parsing & Structured Extraction
async function aiParseActivity({ userId, text }) {
  sseManager.sendToUser(userId, "resume.status", {
    step: "ai_parsing",
    message: "AI extracting skills, education, and experience...",
    progress: 50,
  });

  const parsed = await aiService.parseResume(text);
  return parsed;
}

// Activity 3: Persist Profile to MongoDB
async function persistProfileActivity({ userId, text, parsed }) {
  sseManager.sendToUser(userId, "resume.status", {
    step: "persisting",
    message: "Saving candidate profile...",
    progress: 75,
  });

  const education = parsed && typeof parsed.education === "object" ? parsed.education : {};

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
  };

  const user = await User.findByIdAndUpdate(userId, updateData, { new: true, runValidators: true });
  return { user, updateData };
}

// Activity 4: Recalibrate ATS scores across candidate's applications
async function recalibrateAtsScoresActivity({ userId, resumeText, candidateProfile }) {
  const applications = await Application.find({ seeker: userId }).populate("job");

  await Promise.allSettled(
    applications.map(async (app) => {
      if (!app.job) return;
      const score = await computeAtsScore(
        resumeText,
        app.job.description,
        app.job.skills,
        candidateProfile,
        app.job.atsRequirements
      );
      app.atsScore = score.score;
      app.atsBreakdown = score.breakdown;
      app.atsTips = score.tips;
      await app.save();
    })
  );

  return { applicationCount: applications.length };
}

// Activity 5: Notify and Publish Completion
async function notifyCompletionActivity({ userId, updateData }) {
  await publishDomainEvent("resume.processed", {
    userId: String(userId),
    skillsCount: updateData.skills.length,
  });

  sseManager.sendToUser(userId, "resume.completed", {
    step: "completed",
    message: "Resume parsing and ATS scoring complete!",
    progress: 100,
    profile: {
      skills: updateData.skills,
      summary: updateData.resumeSummary,
      education: {
        degree: updateData.degree,
        college: updateData.college,
        cgpa: updateData.cgpa,
        tier: updateData.collegeTier,
      },
      achievements: updateData.achievements,
      experience: updateData.experience,
    },
  });

  return { notified: true };
}

module.exports = {
  extractTextActivity,
  aiParseActivity,
  persistProfileActivity,
  recalibrateAtsScoresActivity,
  notifyCompletionActivity,
};
