const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  score: { type: Number, default: 0 },
  isHost: { type: Boolean, default: false },
  // For CP mode: how many test cases passed
  testCasesPassed: { type: Number, default: 0 },
  // Speed multiplier tracking
  lastAnswerTime: { type: Date }
});

const competitionLobbySchema = new mongoose.Schema({
  pin: { type: String, required: true, unique: true }, // 6 digit room code
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  topic: { type: String, required: true },
  mode: { type: String, enum: ["QUIZ", "CP"], required: true },
  difficulty: { type: String, enum: ["Easy", "Medium", "Hard", "Mixed"], default: "Mixed" },
  questionCount: { type: Number, default: 5, min: 3, max: 20 },
  
  status: { 
    type: String, 
    enum: ["WAITING", "STARTING", "PLAYING", "LEADERBOARD", "FINISHED"], 
    default: "WAITING" 
  },
  
  // Players in the lobby
  players: [playerSchema],
  
  // --- Quiz Mode Specifics ---
  quizData: [{
    question: String,
    options: [String],
    correctAnswer: Number, // index
    timeLimitSeconds: { type: Number, default: 20 }
  }],
  currentQuestionIndex: { type: Number, default: -1 },
  questionStartTime: { type: Date },

  // --- CP Mode Specifics ---
  cpData: {
    problemStatement: String,
    initialCode: String,
    testCases: [{
      input: String,
      expectedOutput: String
    }]
  },

}, { timestamps: true });

// Optional: Automatically clean up old lobbies after 24h
competitionLobbySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("CompetitionLobby", competitionLobbySchema);
