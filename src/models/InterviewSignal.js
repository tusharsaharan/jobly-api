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
      min: 0.1,
      max: 5.0,
    },
    offsetMs: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      validate: {
        validator: function (v) {
          return v === null || v === undefined || (typeof v === "object" && !Array.isArray(v));
        },
        message: "payload must be a plain object",
      },
    },
    evidenceRef: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true, strict: true, strictQuery: true }
);

interviewSignalSchema.index({ sessionId: 1, offsetMs: 1 });
interviewSignalSchema.index({ sessionId: 1, category: 1 });
interviewSignalSchema.index({ sessionId: 1, category: 1, offsetMs: 1 });
interviewSignalSchema.index({ sessionId: 1, name: 1 });

module.exports = mongoose.model("InterviewSignal", interviewSignalSchema);
