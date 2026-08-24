const mongoose = require("mongoose");

const CompetitionParticipantSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  score: { type: Number, default: 0 },
  finishedAt: { type: Date },
});

const CompetitionRoomSchema = new mongoose.Schema(
  {
    roomKey: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    type: { type: String, enum: ["QUIZ", "CP"], required: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    participants: [CompetitionParticipantSchema],
    status: { type: String, enum: ["WAITING", "LIVE", "COMPLETED"], default: "WAITING" },
    actualStart: { type: Date },
    problems: [
      {
        title: { type: String },
        description: { type: String },
        options: [String], // for QUIZ
        correctAnswer: { type: String }, // for QUIZ
        testCases: [{ input: String, output: String }], // for CP
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("CompetitionRoom", CompetitionRoomSchema);
