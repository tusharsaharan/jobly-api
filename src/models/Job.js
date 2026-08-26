const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  company: { type: String, trim: true, maxlength: 160, default: "" },
  description: { type: String, required: true, trim: true, minlength: 20, maxlength: 8000 },
  skills: [{ type: String, trim: true, maxlength: 80 }],
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
    index: true,
  },
}, { timestamps: true });

// Performance compound indexes
jobSchema.index({ recruiter: 1, createdAt: -1 });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ title: "text", description: "text", skills: "text" });

module.exports = mongoose.model("Job", jobSchema);
