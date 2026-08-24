const mongoose = require("mongoose");

const interviewInviteSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      index: true,
    },
    audienceUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    audienceEmailNormalized: {
      type: String,
      lowercase: true,
      trim: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ["CANDIDATE_INVITE", "INTERVIEWER_INVITE"],
      default: "CANDIDATE_INVITE",
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    lastOpenedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

interviewInviteSchema.index({ session: 1, audienceUser: 1 });

module.exports = mongoose.model("InterviewInvite", interviewInviteSchema);
