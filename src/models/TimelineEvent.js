const mongoose = require("mongoose");

const timelineEventSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      index: true,
    },
    pipeline: {
      type: String,
      enum: ["COMMUNICATION", "CODING", "WHITEBOARD", "STAGE", "AI", "NOTE", "SYSTEM"],
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    offsetMs: {
      type: Number,
      required: true,
      default: 0,
    },
    participant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    participantRole: {
      type: String,
      enum: ["seeker", "recruiter", "system", "observer"],
      default: "system",
    },
    payload: {
      text: { type: String },
      stage: { type: String },
      status: { type: String },
      executionId: { type: String },
      language: { type: String },
      exitCode: { type: Number },
      durationMs: { type: Number },
      checkpointId: { type: String },
      file: { type: String },
      whiteboardSnapshotId: { type: String },
      aiObservation: { type: mongoose.Schema.Types.Mixed },
      codeSnippet: { type: String },
      testResults: { type: mongoose.Schema.Types.Mixed },
      isFinal: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

// High-speed chronological timeline queries
timelineEventSchema.index({ session: 1, offsetMs: 1 });
timelineEventSchema.index({ session: 1, pipeline: 1, offsetMs: 1 });

module.exports = mongoose.model("TimelineEvent", timelineEventSchema);
