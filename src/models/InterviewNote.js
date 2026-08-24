const mongoose = require("mongoose");

const sourceRefSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["timeline_event", "code_location", "transcript_offset"], required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "TimelineEvent" },
    file: { type: String, maxlength: 500 },
    lineStart: { type: Number, min: 1 },
    lineEnd: { type: Number, min: 1 },
    offsetMs: { type: Number, min: 0 },
  },
  { _id: false }
);

const interviewNoteSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "InterviewSession", required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    audience: { type: String, enum: ["interview_team"], default: "interview_team", immutable: true },
    body: { type: String, required: true, trim: true, maxlength: 20000 },
    tags: { type: [String], default: [], validate: [(value) => value.length <= 10, "A note may have at most 10 tags"] },
    pinned: { type: Boolean, default: false },
    sourceRefs: { type: [sourceRefSchema], default: [] },
  },
  { timestamps: true }
);

interviewNoteSchema.index({ session: 1, pinned: -1, updatedAt: -1 });

module.exports = mongoose.model("InterviewNote", interviewNoteSchema);
