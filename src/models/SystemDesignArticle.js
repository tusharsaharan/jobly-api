const mongoose = require("mongoose");

const systemDesignArticleSchema = new mongoose.Schema({
  title:   { type: String, required: true, trim: true },
  slug:    { type: String, required: true, unique: true },
  track:   { type: String, enum: ["HLD", "LLD"], required: true, index: true },
  topic:   { type: String, required: true },                    // from TOPIC_TAXONOMY
  content: { type: String, required: true },                    // Markdown body
  summary: { type: String },
  readTimeMinutes: { type: Number },
  published: { type: Boolean, default: false },

  // Curated external resource links (Phase 1 — before original content exists)
  externalLinks: [{
    title:       String,
    url:         String,
    description: String,
  }],
}, { timestamps: true });

module.exports = mongoose.model("SystemDesignArticle", systemDesignArticleSchema);
