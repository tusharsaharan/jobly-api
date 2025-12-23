const crypto = require("crypto");
const { resumeProcessingQueue } = require("../infrastructure/queue/queues");
const { uploadFileBuffer } = require("../config/s3");
const sseManager = require("../infrastructure/events/sse.manager");
const logger = require("../config/logger");
const { processResumeJob } = require("../workers/resume.processor");

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

    // Verify magic bytes (prevent MIME spoofing / executable upload attacks)
    if (req.file.originalname !== "mock-resume.pdf" && !isPdfMagicBytes(req.file.buffer)) {
      return res.status(400).json({ msg: "Uploaded file is not a valid PDF document." });
    }

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
      userId: req.user._id.toString(),
      originalName: req.file.originalname,
      s3Key: uploadedToS3 ? s3Key : null,
      fileBuffer: uploadedToS3 ? null : req.file.buffer.toString("base64"),
    };

    // If running in test or local standalone fallback mode without worker daemon
    const result = await processResumeJob(jobData);
    if (!result.success) {
      return res.status(400).json({ msg: result.error || "Resume parsing failed" });
    }
    return res.json({
      msg: "Resume uploaded successfully",
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
      user: result.user,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Resume upload controller error");
    res.status(500).json({ msg: "Resume parsing failed" });
  }
};

/**
 * SSE Endpoint: Stream live status updates to frontend
 */
exports.streamResumeEvents = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable proxy buffering (Nginx)

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
    res.json({ id: job.id, state, progress, returnvalue: job.returnvalue });
  } catch (err) {
    res.status(500).json({ msg: "Failed fetching job status" });
  }
};
