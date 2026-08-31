const mongoose = require("mongoose");

const focusSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["STUDY", "QUIZ"],
      required: true,
    },
    topic: {
      type: String,
      required: true,
      trim: true,
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 1,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    strikes: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "COMPLETED", "FAILED", "ABORTED"],
      default: "ACTIVE",
    },
    score: {
      type: Number, // only applicable for QUIZ
      min: 0,
      max: 100,
    },
    quizData: {
      type: mongoose.Schema.Types.Mixed, // stores generated AI quiz questions
    },
    submittedAnswers: {
      type: mongoose.Schema.Types.Mixed, // audit trail: client answers for server-verified scoring
    },
    startTime: {
      type: Date,
      default: Date.now,
    },
    endTime: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FocusSession", focusSessionSchema);
