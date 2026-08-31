const mongoose = require("mongoose");

const applicationSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    seeker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recruiter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["applied", "shortlisted", "rejected"],
      default: "applied",
    },
    atsScore: { type: Number },
    latestAtsAnalysis: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AtsAnalysis",
      default: null,
    },
    atsVersion: { type: String, default: "v2" },
    atsBreakdown: {
      skillMatch: { type: Number },
      experienceRelevance: { type: Number },
      educationFit: { type: Number },
      projectsAndAchievements: { type: Number },
      keywordOptimization: { type: Number },
      overallPresentation: { type: Number },
    },
    atsTips: [{ type: String }],
  },
  { timestamps: true }
);

// Prevent duplicate applications per seeker per job
applicationSchema.index({ job: 1, seeker: 1 }, { unique: true });
// Fast recruiter pipeline lookups
applicationSchema.index({ recruiter: 1, status: 1 });
applicationSchema.index({ seeker: 1, createdAt: -1 });
applicationSchema.index({ seeker: 1, status: 1, createdAt: -1 });
applicationSchema.index({ recruiter: 1, status: 1, createdAt: -1 });
applicationSchema.index({ job: 1, atsScore: -1 });
applicationSchema.index({ job: 1, status: 1 });

module.exports = mongoose.model("Application", applicationSchema);
