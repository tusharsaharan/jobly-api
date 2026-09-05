const mongoose = require("mongoose");

const evidenceItemSchema = new mongoose.Schema({
  timelineEvent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TimelineEvent",
    default: null,
  },
  offsetMs: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
    required: true,
    trim: true,
  },
  artifactType: {
    type: String,
    enum: ["TRANSCRIPT", "CODE", "EXECUTION", "WHITEBOARD", "NOTE"],
    required: true,
  },
  artifactRef: {
    type: String,
    default: "",
  },
});

const categoryScoreSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    enum: [
      "Coding & Algorithms",
      "System Architecture & Scalability",
      "Problem Solving & Decomposition",
      "Communication & Technical Clarity",
      "Testing & Edge-Case Handling",
    ],
  },
  score: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  notes: {
    type: String,
    default: "",
  },
  evidence: [evidenceItemSchema],
});

const interviewScorecardSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      unique: true,
      index: true,
    },
    evaluator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    hiringDecision: {
      type: String,
      enum: ["STRONG_HIRE", "HIRE", "LEAN_HIRE", "LEAN_REJECT", "REJECT", "PENDING"],
      default: "PENDING",
      required: true,
    },
    overallNotes: {
      type: String,
      default: "",
    },
    categories: [categoryScoreSchema],
    aiAssessment: {
      recommendedDecision: { type: String },
      confidenceScore: { type: Number },
      strengths: [{ type: String }],
      growthAreas: [{ type: String }],
      competencyCoverage: { type: mongoose.Schema.Types.Mixed },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InterviewScorecard", interviewScorecardSchema);
