const mongoose = require("mongoose");

const interviewProblemSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      default: "default",
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 200,
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: [
        "Algorithms",
        "Data Structures",
        "System Design",
        "Concurrency & Multithreading",
        "Database & SQL",
        "Debugging",
        "Fullstack",
      ],
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    constraints: [
      {
        type: String,
      },
    ],
    examples: [
      {
        input: { type: String, required: true },
        output: { type: String, required: true },
        explanation: { type: String },
      },
    ],
    starterCode: {
      python: { type: String, default: "" },
      javascript: { type: String, default: "" },
      typescript: { type: String, default: "" },
      cpp: { type: String, default: "" },
      java: { type: String, default: "" },
    },
    testCases: [
      {
        input: { type: String, required: true },
        expectedOutput: { type: String, required: true },
        isHidden: { type: Boolean, default: false },
        explanation: { type: String },
      },
    ],
    expectedConcepts: [
      {
        type: String,
      },
    ],
    timeLimitMs: {
      type: Number,
      default: 5000,
      min: 100,
      max: 30000,
    },
    memoryLimitMb: {
      type: Number,
      default: 256,
      min: 16,
      max: 1024,
    },
  },
  { timestamps: true }
);

interviewProblemSchema.index({ difficulty: 1, category: 1 });

module.exports = mongoose.model("InterviewProblem", interviewProblemSchema);
