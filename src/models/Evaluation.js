const mongoose = require("mongoose");

const evidenceReferenceSchema = new mongoose.Schema(
  {
    refType: {
      type: String,
      enum: ["TRANSCRIPT", "CODE_CHECKPOINT", "EXECUTION", "WHITEBOARD_SNAPSHOT", "TIMELINE_EVENT", "NOTE"],
      required: true,
    },
    timelineEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimelineEvent",
      default: null,
    },
    checkpointId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CodeCheckpoint",
      default: null,
    },
    snapshotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhiteboardSnapshot",
      default: null,
    },
    quote: {
      type: String,
      default: null,
    },
    note: {
      type: String,
      default: null,
    },
    offsetMs: {
      type: Number,
      default: 0,
    },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const competencyScoreSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
    },
    score: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    notes: {
      type: String,
      default: "",
    },
    evidenceRefs: {
      type: [evidenceReferenceSchema],
      default: [],
    },
  },
  { _id: false }
);

const evaluationSchema = new mongoose.Schema(
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
      index: true,
    },
    overallRating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    decision: {
      type: String,
      enum: ["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE", "PENDING"],
      default: "PENDING",
      required: true,
    },
    competencies: {
      type: [competencyScoreSchema],
      default: [],
    },
    strengths: {
      type: [String],
      default: [],
    },
    weaknesses: {
      type: [String],
      default: [],
    },
    privateNotes: {
      type: String,
      default: "",
    },
    aiInsights: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Evaluation", evaluationSchema);
