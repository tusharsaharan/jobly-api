const mongoose = require("mongoose");

const whiteboardSnapshotSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      index: true,
    },
    objects: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    boardType: {
      type: String,
      enum: ["LEGACY", "EXCALIDRAW"],
      default: "LEGACY",
    },
    canvasWidth: {
      type: Number,
      default: 1920,
    },
    canvasHeight: {
      type: Number,
      default: 1080,
    },
    sequenceNumber: {
      type: Number,
      required: true,
    },
    previewImageUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

whiteboardSnapshotSchema.index({ session: 1, sequenceNumber: 1 });

module.exports = mongoose.model("WhiteboardSnapshot", whiteboardSnapshotSchema);
