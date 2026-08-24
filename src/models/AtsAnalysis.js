const mongoose = require("mongoose");

const EvidenceRefSchema = new mongoose.Schema({
  section: { type: String, required: true },
  pageNumber: { type: Number, default: null },
  charStart: { type: Number, default: null },
  charEnd: { type: Number, default: null },
  quote: { type: String, required: true, maxlength: 240 },
}, { _id: false });

const AtsCategoryResultSchema = new mongoose.Schema({
  name: { type: String, required: true },
  label: { type: String, required: true },
  score: { type: Number, required: true },
  maxPoints: { type: Number, required: true },
  percentage: { type: Number, required: true },
  weight: { type: Number, required: true },
  explanation: { type: String, required: true },
  matchedCount: { type: Number, default: 0 },
  totalCount: { type: Number, default: 0 },
  evidenceIds: [{ type: String }],
  redistributed: { type: Boolean, default: false },
}, { _id: false });

const RequirementEvidenceSchema = new mongoose.Schema({
  id: { type: String, required: true },
  requirementKey: { type: String, required: true },
  category: { type: String, required: true },
  label: { type: String, required: true },
  isMustHave: { type: Boolean, default: false },
  weight: { type: Number, default: 1 },
  matchedSource: { type: String, required: true },
  matchedText: { type: String, required: true },
  evidenceRef: { type: EvidenceRefSchema, required: true },
}, { _id: false });

const RequirementGapSchema = new mongoose.Schema({
  id: { type: String, required: true },
  requirementKey: { type: String, required: true },
  category: { type: String, required: true },
  label: { type: String, required: true },
  isMustHave: { type: Boolean, default: false },
  importance: { type: String, enum: ["critical", "recommended", "optional"], default: "recommended" },
  explanation: { type: String, required: true },
  suggestedAction: { type: String, required: true },
}, { _id: false });

const AtsSuggestionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  priority: { type: String, enum: ["high", "medium", "low"], default: "medium" },
  category: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  action: { type: String, required: true },
  evidence: [EvidenceRefSchema],
  safeToApply: { type: Boolean, default: true },
  dedupeKey: { type: String, required: true },
}, { _id: false });

const AtsAnalysisSchema = new mongoose.Schema({
  schemaVersion: { type: String, default: "ats-analysis/2026-08-v1" },
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: "Application", default: null, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null, index: true },
  resumeUploadId: { type: String, required: true, index: true },
  resumeHash: { type: String, required: true },
  jobRevision: { type: Number, default: 1 },
  calculatedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["completed", "partial", "failed"], default: "completed" },
  overallScore: { type: Number, min: 0, max: 100, default: null },
  confidence: { type: Number, min: 0, max: 1, default: 0.85 },
  categories: [AtsCategoryResultSchema],
  matchedRequirements: [RequirementEvidenceSchema],
  gaps: [RequirementGapSchema],
  suggestions: [AtsSuggestionSchema],
  exclusions: [{ field: String, reason: String }],
  engine: {
    version: { type: String, default: "ats-analysis/2026-08-v1" },
    rulesetHash: { type: String, required: true },
    taxonomyVersion: { type: String, default: "skills-taxonomy/2026-08-v1" },
  },
}, {
  timestamps: true,
});

AtsAnalysisSchema.index({ userId: 1, calculatedAt: -1 });
AtsAnalysisSchema.index({ applicationId: 1, calculatedAt: -1 });

module.exports = mongoose.model("AtsAnalysis", AtsAnalysisSchema);
