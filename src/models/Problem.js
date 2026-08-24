const mongoose = require("mongoose");

const problemSchema = new mongoose.Schema({
  title:      { type: String, required: true, trim: true },
  link:       { type: String, required: true },   // leetcode.com/problems/...
  difficulty: { type: String, enum: ["EASY", "MEDIUM", "HARD", "UNKNOWN"], default: "UNKNOWN" },
  topics:     [{ type: String, trim: true }],                   // ["Array", "Hash Table"]
  source:     { type: String, enum: ["dsa", "oa"], required: true },

  // Company frequency data (one problem can appear in multiple companies/time-windows)
  companyFrequencies: [{
    company:        { type: String, required: true },
    timeWindow:     { type: String, enum: ["30d", "90d", "180d", "180d+", "all"] },
    frequency:      { type: Number, default: 0 },
    acceptanceRate: { type: Number, default: 0 },
  }],

  // OA-specific fields (may be partially populated)
  oaCompany:    { type: String },
  oaRawContent: { type: String },       // Original question text if no external link

}, { timestamps: true });

problemSchema.index({ link: 1 }, { unique: true });
problemSchema.index({ source: 1, difficulty: 1 });
problemSchema.index({ "companyFrequencies.company": 1 });
problemSchema.index({ topics: 1 });

module.exports = mongoose.model("Problem", problemSchema);
