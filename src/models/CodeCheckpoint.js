const mongoose = require("mongoose");

const fileSnapshotSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    name: { type: String, required: true },
    content: { type: String, default: "" },
    language: { type: String, default: "python" },
  },
  { _id: false }
);

const codeCheckpointSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      index: true,
    },
    triggerType: {
      type: String,
      enum: ["EXECUTION", "STAGE_TRANSITION", "AUTO_SAVE", "MANUAL"],
      required: true,
    },
    triggerLabel: {
      type: String,
      default: "Checkpoint",
    },
    filesSnapshot: {
      type: [fileSnapshotSchema],
      default: [],
    },
    yjsStateVector: {
      type: Buffer,
      default: null,
    },
    offsetMs: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    sequenceNumber: {
      type: Number,
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

codeCheckpointSchema.index({ session: 1, offsetMs: 1, sequenceNumber: 1 });
codeCheckpointSchema.index({ session: 1, sequenceNumber: 1 });
codeCheckpointSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // 30 days TTL

module.exports = mongoose.model("CodeCheckpoint", codeCheckpointSchema);
