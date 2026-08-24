const mongoose = require("mongoose");

const interviewSignalSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ["coding", "communication", "whiteboard", "attention", "execution"],
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      index: true,
    },
    indicator: {
      type: String,
      enum: ["positive", "neutral", "concern"],
      default: "neutral",
    },
    weight: {
      type: Number,
      default: 1.0,
    },
    offsetMs: {
      type: Number,
      default: 0,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    evidenceRef: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

interviewSignalSchema.index({ sessionId: 1, offsetMs: 1 });

module.exports = mongoose.model("InterviewSignal", interviewSignalSchema);
