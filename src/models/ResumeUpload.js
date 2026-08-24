const mongoose = require("mongoose");

const ResumeUploadSchema = new mongoose.Schema({
  uploadId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  fileName: { type: String, required: true },
  mimeType: { type: String, default: "application/pdf" },
  fileSize: { type: Number, default: 0 },
  sha256: { type: String, required: true },
  state: {
    type: String,
    enum: [
      "received",
      "scanning",
      "text_extracting",
      "profile_extracting",
      "validating",
      "health_analyzing",
      "rescoring_applications",
      "completed",
      "completed_with_warnings",
      "failed",
    ],
    default: "received",
    index: true,
  },
  progress: { type: Number, min: 0, max: 100, default: 10 },
  messageCode: { type: String, default: "upload_received" },
  resumeProfile: { type: Object, default: null },
  healthScore: { type: Number, default: null },
  healthAnalysis: { type: Object, default: null },
  warnings: [{ code: String, message: String, severity: String, field: String }],
  errorMessage: { type: String, default: null },
  analysisId: { type: String, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model("ResumeUpload", ResumeUploadSchema);
