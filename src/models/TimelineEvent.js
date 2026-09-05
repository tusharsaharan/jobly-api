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
      enum: ["COMMUNICATION", "CODING", "WHITEBOARD", "STAGE", "AI", "NOTE", "SYSTEM", "INTEGRITY"],
      required: true,
    },
    eventType: {
      type: String,
      required: true,
    },
    offsetMs: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    sequenceNumber: {
      type: Number,
      index: true,
      default: null,
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
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// High-speed chronological timeline queries — ordering uses sequenceNumber as tie-breaker for deterministic replay at scale
timelineEventSchema.index({ session: 1, offsetMs: 1, sequenceNumber: 1 });
timelineEventSchema.index({ session: 1, pipeline: 1, offsetMs: 1, sequenceNumber: 1 });
timelineEventSchema.index({ session: 1, eventType: 1, offsetMs: 1, sequenceNumber: 1 });
timelineEventSchema.index({ session: 1, sequenceNumber: 1 });
timelineEventSchema.index({ participant: 1, createdAt: -1 });
// TTL removed for compliance — no expireAfterSeconds. Ensure legacy TTL index is dropped if it exists.

// Auto-increment sequenceNumber via Redis counter with Mongo fallback for strict ordering
timelineEventSchema.pre("save", async function (next) {
  if (this.sequenceNumber == null) {
    try {
      const { redis } = require("../config/redis");
      if (redis && redis.status === "ready") {
        const key = `timeline:seq:${this.session}`;
        const seq = await redis.incr(key);
        // Redis incr is atomic per session key
        this.sequenceNumber = seq;
        return next();
      }
    } catch (_e) {
      // fall through to Mongo fallback
    }
    try {
      const maxDoc = await this.constructor
        .findOne({ session: this.session })
        .sort({ sequenceNumber: -1 })
        .select("sequenceNumber")
        .lean();
      this.sequenceNumber = (maxDoc?.sequenceNumber || 0) + 1;
    } catch {
      this.sequenceNumber = 1;
    }
  }
  next();
});

// Compliance helper: drop legacy TTL index if present (expireAfterSeconds: 2592000)
timelineEventSchema.statics.ensureNoTTL = async function () {
  try {
    const indexes = await this.collection.indexes();
    for (const idx of indexes) {
      if (idx.expireAfterSeconds != null) {
        await this.collection.dropIndex(idx.name);
      }
    }
  } catch (_e) {
    // ignore if collection not yet created or no indexes
  }
};

const TimelineEvent = mongoose.model("TimelineEvent", timelineEventSchema);
// Proactively remove TTL index once indexes are built
TimelineEvent.on("index", async () => {
  try {
    await TimelineEvent.ensureNoTTL();
  } catch {}
});

module.exports = TimelineEvent;
