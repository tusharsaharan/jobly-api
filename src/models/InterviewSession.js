const mongoose = require("mongoose");

const interviewSessionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      default: "default",
      index: true,
    },
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
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
    additionalInterviewers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    title: {
      type: String,
      required: true,
      trim: true,
      default: "Technical Interview",
    },
    roomKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["SCHEDULED", "WAITING_ROOM", "LIVE", "COMPLETED", "CANCELLED"],
      default: "SCHEDULED",
      index: true,
    },
    stage: {
      type: String,
      enum: [
        "WAITING_ROOM",
        "INTRODUCTION",
        "CODING",
        "DEBUGGING",
        "SYSTEM_DESIGN",
        "DISCUSSION",
        "QUESTIONS",
        "FEEDBACK",
        "COMPLETED",
      ],
      default: "WAITING_ROOM",
    },
    scheduledStart: {
      type: Date,
      required: true,
    },
    actualStart: {
      type: Date,
      default: null,
    },
    actualEnd: {
      type: Date,
      default: null,
    },
    allowedLanguages: {
      type: [String],
      default: ["python", "javascript", "typescript", "cpp", "java"],
    },
    activeProblem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InterviewProblem",
      default: null,
    },
    activeFile: {
      type: String,
      default: "solution.py",
    },
    codeWorkspace: {
      files: [
        {
          name: { type: String, required: true },
          path: { type: String, required: true },
          content: { type: String, default: "" },
          language: { type: String, default: "python" },
        },
      ],
    },
    whiteboardState: {
      elements: { type: mongoose.Schema.Types.Mixed, default: [] },
      appState: { type: mongoose.Schema.Types.Mixed, default: {} },
      snapshotVersion: { type: Number, default: 1 },
    },
    recordingUrl: {
      type: String,
      default: null,
    },
    aiSummary: {
      type: String,
      default: null,
    },
    // Binary Yjs document snapshots for persistence across reconnects
    yjsState: {
      type: Buffer,
      default: null,
    },
    yjsWhiteboardState: {
      type: Buffer,
      default: null,
    },
  },
  { timestamps: true }
);

// Performance compound indexes
interviewSessionSchema.index({ tenantId: 1, status: 1 });
interviewSessionSchema.index({ seeker: 1, status: 1 });
interviewSessionSchema.index({ recruiter: 1, status: 1 });

// Valid state machine transitions
const VALID_STATUS_TRANSITIONS = {
  SCHEDULED: ["WAITING_ROOM", "LIVE", "CANCELLED"],
  WAITING_ROOM: ["LIVE", "CANCELLED"],
  LIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [], // Terminal
  CANCELLED: [], // Terminal
};

const VALID_STAGES = [
  "WAITING_ROOM",
  "INTRODUCTION",
  "CODING",
  "DEBUGGING",
  "SYSTEM_DESIGN",
  "DISCUSSION",
  "QUESTIONS",
  "FEEDBACK",
  "COMPLETED",
];

interviewSessionSchema.methods.canTransitionToStatus = function (newStatus) {
  const allowed = VALID_STATUS_TRANSITIONS[this.status] || [];
  return allowed.includes(newStatus);
};

interviewSessionSchema.methods.transitionStatus = function (newStatus) {
  if (!this.canTransitionToStatus(newStatus)) {
    throw new Error(`Invalid status transition from ${this.status} to ${newStatus}`);
  }
  this.status = newStatus;
  if (newStatus === "LIVE" && !this.actualStart) {
    this.actualStart = new Date();
  }
  if (newStatus === "COMPLETED" && !this.actualEnd) {
    this.actualEnd = new Date();
    this.stage = "COMPLETED";
  }
  return this;
};

interviewSessionSchema.methods.transitionStage = function (newStage) {
  if (!VALID_STAGES.includes(newStage)) {
    throw new Error(`Invalid stage: ${newStage}`);
  }
  if (this.status === "COMPLETED" || this.status === "CANCELLED") {
    throw new Error(`Cannot transition stage on a ${this.status} interview session`);
  }
  this.stage = newStage;
  if (newStage !== "WAITING_ROOM" && this.status === "WAITING_ROOM") {
    this.status = "LIVE";
    if (!this.actualStart) this.actualStart = new Date();
  }
  if (newStage === "COMPLETED") {
    this.status = "COMPLETED";
    if (!this.actualEnd) this.actualEnd = new Date();
  }
  return this;
};

module.exports = mongoose.model("InterviewSession", interviewSessionSchema);
