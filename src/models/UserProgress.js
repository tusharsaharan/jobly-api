const mongoose = require("mongoose");

const userProgressSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true, // One progress document per user
  },
  completedDSAQuestions: [{
    type: String, // Storing the URL or unique title of the question
    trim: true
  }],
  completedOAQuestions: [{
    type: String, // Storing the URL or unique title of the question
    trim: true
  }],
}, { timestamps: true });

module.exports = mongoose.model("UserProgress", userProgressSchema);
