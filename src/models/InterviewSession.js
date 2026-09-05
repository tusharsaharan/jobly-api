const mongoose = require("mongoose");

// Sub-schema for codeWorkspace.files — limited size to avoid 16MB breach while keeping scheduleInterview functional
const workspaceFileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    path: { type: String, required: true, trim: true },
    content: {
      type: String,
      default: "",
      validate: {
        validator: function (v) {
          return !v || v.length <= 200 * 1024; // 200KB per file
        },
        message: "File content exceeds 200KB limit",
      },
    },
    language: { type: String, default: "python" },
  },
  { _id: false }
);

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
      activeLanguage: { type: String, default: "python" },
      files: {
        type: [workspaceFileSchema],
        default: [],
        validate: {
          validator: function (v) {
            return v.length <= 20;
          },
          message: "Too many workspace files (max 20)",
        },
      },
    },
    whiteboardState: {
      appState: { type: mongoose.Schema.Types.Mixed, default: {} },
      snapshotVersion: { type: Number, default: 1 },
      // Elements removed to prevent 16MB document limit breach.
      // Whiteboard state is maintained in WhiteboardSnapshot.
    },
    recordingUrl: {
      type: String,
      default: null,
    },
    aiSummary: {
      type: String,
      default: null,
    },
    // Canonical Monotonic Execution Sequence Counter and Latest Execution Snapshot
    executionSequence: {
      type: Number,
      default: 0,
    },
    lastExecution: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    whiteboardSequence: {
      type: Number,
      default: 0,
    },
    // Binary Yjs document snapshots for persistence across reconnects
    yjsState: {
      type: Buffer,
      default: null,
      validate: {
        validator: function(val) {
          return !val || val.length <= 10 * 1024 * 1024; // 10MB limit
        },
        message: 'yjsState exceeds 10MB limit'
      }
    },
    yjsWhiteboardState: {
      type: Buffer,
      default: null,
      validate: {
        validator: function(val) {
          return !val || val.length <= 10 * 1024 * 1024; // 10MB limit
        },
        message: 'yjsWhiteboardState exceeds 10MB limit'
      }
    },
  },
  { timestamps: true }
);

// Performance compound indexes
interviewSessionSchema.index({ tenantId: 1, roomKey: 1 }, { unique: true });
interviewSessionSchema.index({ tenantId: 1, status: 1 });
interviewSessionSchema.index({ seeker: 1, status: 1 });
interviewSessionSchema.index({ recruiter: 1, status: 1, scheduledStart: -1 });
interviewSessionSchema.index({ recruiter: 1, scheduledStart: -1 });
interviewSessionSchema.index({ seeker: 1, scheduledStart: -1 });

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
  if (newStage !== "WAITING_ROOM" && (this.status === "WAITING_ROOM" || this.status === "SCHEDULED")) {
    this.status = "LIVE";
    if (!this.actualStart) this.actualStart = new Date();
  }
  if (newStage === "COMPLETED") {
    this.status = "COMPLETED";
    if (!this.actualEnd) this.actualEnd = new Date();
  }
  return this;
};

// Orphan FK cleanup: delete related TimelineEvents, CodeCheckpoints, WhiteboardSnapshots, InterviewSignals when session deleted
async function cleanupRelatedDocs(sessionId) {
  if (!sessionId) return;
  try {
    const TimelineEvent = require("./TimelineEvent");
    const CodeCheckpoint = require("./CodeCheckpoint");
    const WhiteboardSnapshot = require("./WhiteboardSnapshot");
    const InterviewSignal = require("./InterviewSignal");
    await Promise.all([
      TimelineEvent.deleteMany({ session: sessionId }).catch(() => {}),
      CodeCheckpoint.deleteMany({ session: sessionId }).catch(() => {}),
      WhiteboardSnapshot.deleteMany({ session: sessionId }).catch(() => {}),
      InterviewSignal.deleteMany({ sessionId: sessionId }).catch(() => {}),
      // Fallback for legacy field name if any
      InterviewSignal.deleteMany({ session: sessionId }).catch(() => {}),
    ]);
  } catch (_e) {
    // best-effort cleanup, ignore errors
  }
}

// Document middleware — covers session.deleteOne() and session.remove()
interviewSessionSchema.pre("deleteOne", { document: true, query: false }, async function (next) {
  await cleanupRelatedDocs(this._id);
  next();
});

interviewSessionSchema.pre("remove", async function (next) {
  await cleanupRelatedDocs(this._id);
  next();
});

// Query middleware — covers findOneAndDelete, findByIdAndDelete, findOneAndRemove
interviewSessionSchema.pre("findOneAndDelete", async function (next) {
  try {
    const doc = await this.model.findOne(this.getFilter()).lean();
    if (doc?._id) await cleanupRelatedDocs(doc._id);
  } catch {}
  next();
});

interviewSessionSchema.post("findOneAndDelete", async function (doc) {
  if (doc?._id) await cleanupRelatedDocs(doc._id);
});

interviewSessionSchema.post("deleteOne", { document: true, query: false }, async function () {
  if (this._id) await cleanupRelatedDocs(this._id);
});

// Also handle deleteOne query form (InterviewSession.deleteOne({ _id }))
interviewSessionSchema.pre("deleteOne", { document: false, query: true }, async function (next) {
  try {
    const filter = this.getFilter();
    if (filter._id) {
      await cleanupRelatedDocs(filter._id);
    } else {
      const doc = await this.model.findOne(filter).lean();
      if (doc?._id) await cleanupRelatedDocs(doc._id);
    }
  } catch {}
  next();
});

module.exports = mongoose.model("InterviewSession", interviewSessionSchema);
