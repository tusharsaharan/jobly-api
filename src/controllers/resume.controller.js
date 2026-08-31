const crypto = require("crypto");
const { resumeProcessingQueue } = require("../infrastructure/queue/queues");
const { uploadFileBuffer } = require("../config/s3");
const sseManager = require("../infrastructure/events/sse.manager");
const logger = require("../config/logger");
const { processResumeJob } = require("../workers/resume.processor");
const ResumeUpload = require("../models/ResumeUpload");
const User = require("../models/User");
const { scoreResumeHealth } = require("../modules/ats");

/**
 * Validate PDF Magic Bytes (%PDF in first 4 bytes)
 */
function isPdfMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return (
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46    // F
  );
}

exports.uploadResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: "No file uploaded" });
    }

    // Verify magic bytes (prevent MIME spoofing / executable upload attacks) - always validate regardless of filename
    if (!isPdfMagicBytes(req.file.buffer)) {
      return res.status(400).json({ msg: "Uploaded file is not a valid PDF document." });
    }

    const uploadId = `upl-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");

    // Duplicate SHA dedupe: check existing upload with same sha256 for this user
    const existingDuplicate = await ResumeUpload.findOne({ sha256, userId: req.user._id });
    if (existingDuplicate) {
      return res.status(409).json({ msg: "Duplicate resume detected - identical file already uploaded", existingUploadId: existingDuplicate.uploadId, sha256 });
    }

    // Create durable ResumeUpload state record (owner mirrors userId for {sha256, owner} unique index)
    await ResumeUpload.create({
      uploadId,
      userId: req.user._id,
      owner: req.user._id,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      sha256,
      state: "scanning",
      progress: 15,
      messageCode: "upload_received",
    });

    const s3Key = `resumes/${req.user._id}/${crypto.randomUUID()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    // Upload to S3/MinIO in background if available
    let uploadedToS3 = false;
    try {
      if (process.env.NODE_ENV !== "test") {
        await uploadFileBuffer(req.file.buffer, s3Key, req.file.mimetype);
        uploadedToS3 = true;
      }
    } catch (err) {
      logger.warn({ err: err.message }, "S3 upload bypassed, using direct memory buffer");
    }

    const jobData = {
      uploadId,
      userId: req.user._id.toString(),
      originalName: req.file.originalname,
      s3Key: uploadedToS3 ? s3Key : null,
      fileBuffer: uploadedToS3 ? null : req.file.buffer.toString("base64"),
    };

    const result = await processResumeJob(jobData);
    if (!result.success) {
      return res.status(400).json({ msg: result.error || "Resume parsing failed", uploadId });
    }

    return res.json({
      msg: "Resume uploaded successfully",
      uploadId,
      skills: result.user.skills,
      summary: result.user.resumeSummary,
      education: {
        degree: result.user.degree,
        college: result.user.college,
        cgpa: result.user.cgpa,
        tier: result.user.collegeTier,
      },
      achievements: result.user.achievements,
      experience: result.user.experience,
      resumeProfile: result.resumeProfile || result.user.resumeProfile,
      resumeHealth: result.healthResult || result.user.resumeHealth,
      user: result.user,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Resume upload controller error");
    res.status(500).json({ msg: "Resume parsing failed" });
  }
};

/**
 * Get durable upload status
 */
exports.getUploadStatus = async (req, res) => {
  try {
    const { uploadId } = req.params;
    const uploadRecord = await ResumeUpload.findOne({ uploadId, userId: req.user._id });
    if (!uploadRecord) {
      return res.status(404).json({ msg: "Upload record not found" });
    }
    return res.json(uploadRecord);
  } catch (err) {
    logger.error({ err: err.message }, "getUploadStatus error");
    res.status(500).json({ msg: "Failed to fetch upload status" });
  }
};

/**
 * Get current candidate's canonical ResumeProfile and Health analysis
 */
exports.getResumeProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }
    return res.json({
      resumeProfile: user.resumeProfile || null,
      resumeHealth: user.resumeHealth || null,
      skills: user.skills || [],
      summary: user.resumeSummary || "",
      experience: user.experience || [],
      achievements: user.achievements || [],
    });
  } catch (err) {
    logger.error({ err: err.message }, "getResumeProfile error");
    res.status(500).json({ msg: "Failed to fetch resume profile" });
  }
};

/**
 * Update candidate's canonical ResumeProfile and re-evaluate health score
 */
exports.updateResumeProfile = async (req, res) => {
  try {
    const { resumeProfile } = req.body;
    if (!resumeProfile) {
      return res.status(400).json({ msg: "resumeProfile payload required" });
    }

    const healthResult = scoreResumeHealth(resumeProfile);
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        resumeProfile,
        resumeHealth: healthResult,
        skills: (resumeProfile.skills || []).map((s) => s.label || s.canonicalId),
        resumeSummary: resumeProfile.summary || "",
      },
      { new: true }
    );

    return res.json({
      msg: "Resume profile updated successfully",
      resumeProfile: user.resumeProfile,
      resumeHealth: user.resumeHealth,
    });
  } catch (err) {
    logger.error({ err: err.message }, "updateResumeProfile error");
    res.status(500).json({ msg: "Failed to update resume profile" });
  }
};

/**
 * SSE Endpoint: Stream live status updates to frontend
 */
exports.streamResumeEvents = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  sseManager.addClient(req.user._id, res);
  res.write(`event: connected\ndata: ${JSON.stringify({ msg: "SSE connection established" })}\n\n`);
};

/**
 * Get job status
 */
exports.getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await resumeProcessingQueue.getJob(jobId);
    if (!job) {
      return res.status(404).json({ msg: "Job not found" });
    }
    const state = await job.getState();
    const progress = job.progress;
    return res.json({ jobId, state, progress });
  } catch (err) {
    logger.error({ err: err.message }, "getJobStatus error");
    res.status(500).json({ msg: "Failed to fetch job status" });
  }
};
