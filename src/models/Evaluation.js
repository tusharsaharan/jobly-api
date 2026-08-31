const mongoose = require("mongoose");

const sanitizeHtml = (str) => {
  if (typeof str !== "string") return str;
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
};

const evidenceReferenceSchema = new mongoose.Schema(
  {
    refType: {
      type: String,
      enum: ["TRANSCRIPT", "CODE_CHECKPOINT", "EXECUTION", "EXECUTION_RESULT", "WHITEBOARD_SNAPSHOT", "TIMELINE_EVENT", "NOTE"],
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
      set: sanitizeHtml,
    },
    note: {
      type: String,
      default: null,
      set: sanitizeHtml,
    },
    offsetMs: {
      type: Number,
      default: 0,
      min: 0,
    },
    verificationHash: {
      type: String,
      default: null,
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
      set: sanitizeHtml,
    },
    evidenceRefs: {
      type: [evidenceReferenceSchema],
      default: [],
      validate: {
        validator: function (v) { return Array.isArray(v) && v.length >= 1; },
        message: "Each competency must have at least one evidence reference",
      },
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
      enum: ["STRONG_HIRE", "HIRE", "LEAN_HIRE", "LEAN_REJECT", "REJECT", "NO_HIRE", "STRONG_NO_HIRE", "PENDING"],
      default: "PENDING",
      required: true,
    },
    competencies: {
      type: [competencyScoreSchema],
      default: [],
      validate: {
        validator: function (v) { return Array.isArray(v) && v.length > 0; },
        message: "At least one competency required",
      },
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

evaluationSchema.index({ session: 1, evaluator: 1 }, { unique: true });

module.exports = mongoose.model("Evaluation", evaluationSchema);
