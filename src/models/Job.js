const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  company: { type: String, trim: true, maxlength: 160, default: "" },
  description: { type: String, required: true, trim: true, minlength: 20, maxlength: 8000 },
  skills: {
    type: [{ type: String, trim: true, maxlength: 80 }],
    validate: [array => array.length <= 30, 'Exceeds maximum allowed skills (30)']
  },
  location: { type: String, trim: true, maxlength: 160, default: "" },
  type: { type: String, enum: ["", "Full-time", "Part-time", "Contract", "Internship"], default: "" },
  atsRequirements: {
    minCgpa: { type: Number, min: 0, max: 10, default: 0 },
    targetCollegeTier: { type: String, enum: ["tier1", "tier2", "tier3", "any"], default: "any" },
    minExperienceYears: { type: Number, min: 0, max: 60, default: 0 },
    requiredDegree: { type: String, trim: true, maxlength: 120, default: "" }
  },
  salaryRange: {
    min: { type: Number },
    max: { type: Number },
    currency: { type: String, default: "USD" },
    period: { type: String, enum: ["hourly", "monthly", "annual"], default: "annual" },
    visible: { type: Boolean, default: true }
  },
  status: {
    type: String,
    enum: ["draft", "open", "closed", "archived"],
    default: "open",
    index: true
  },
  closureReason: {
    type: String,
    enum: ["filled", "abandoned", "cancelled", "expired", "none"],
    default: "none"
  },
  closedAt: {
    type: Date
  },
  recruiter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
}, { timestamps: true });

// Performance compound indexes
jobSchema.index({ recruiter: 1, createdAt: -1 });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ skills: 1, createdAt: -1 });
jobSchema.index({ recruiter: 1, skills: 1 });
jobSchema.index({ skills: 1 });
jobSchema.index({ location: 1, type: 1, skills: 1, createdAt: -1 });
// Native text index removed in favor of external Atlas Search

module.exports = mongoose.model("Job", jobSchema);
