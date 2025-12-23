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
      index: true,
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
    sequenceNumber: {
      type: Number,
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

codeCheckpointSchema.index({ session: 1, sequenceNumber: 1 });
codeCheckpointSchema.index({ session: 1, createdAt: 1 });

module.exports = mongoose.model("CodeCheckpoint", codeCheckpointSchema);
