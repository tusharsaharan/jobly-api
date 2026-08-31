const mongoose = require("mongoose");

const candidateTopicWeaknessSchema = new mongoose.Schema({
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  topic:     { type: String, required: true },          // Must be a key from TOPIC_TAXONOMY
  category:  { type: String },                          // "DSA", "CS_FUNDAMENTALS", "HLD", "LLD"
  confidence: { type: Number, min: 0, max: 1, default: 0.8 },

  // Provenance — which feedback this was extracted from
  sourceType:    { type: String, enum: ["evaluation", "interview_note", "scorecard"], required: true },
  sourceId:      { type: mongoose.Schema.Types.ObjectId, required: true },
  sourceSession: { type: mongoose.Schema.Types.ObjectId, ref: "InterviewSession" },
  rawText:       { type: String },   // The original freeform text this was extracted from

  // Resolution tracking
  resolved:   { type: Boolean, default: false },
  resolvedAt: { type: Date },
  resolvedVia: { type: String, enum: ["manual", "quiz", null], default: null },
  resolvedScore: { type: Number, min: 0, max: 100 },

  // Cached study resource recommendations — precise (RAG) + extensive (curated by type)
  cachedResources: [{
    title:       String,
    url:         String,
    description: String,
    type:        { type: String, enum: ["rag","article","practice","video","search","docs"], default: "rag" },
    score:       Number, // Hybrid RRF score 0-0.98
    confidence:  { type: String, enum: ["high", "medium", "low", "none"] },
    relevancePct: Number, // 0-98
    retrievedAt: Date,
  }],
}, { timestamps: true });

candidateTopicWeaknessSchema.index({ candidate: 1, resolved: 1 });
candidateTopicWeaknessSchema.index({ candidate: 1, topic: 1, sourceId: 1 }, { unique: true });

module.exports = mongoose.model("CandidateTopicWeakness", candidateTopicWeaknessSchema);
