const mongoose = require("mongoose");

const embeddingChunkSchema = new mongoose.Schema({
  // The raw text chunk that was embedded
  content: { type: String, required: true },

  // 3072-dim float vector (Gemini gemini-embedding-001). Falls back to 128-dim
  // deterministic projection when GEMINI_API_KEY unavailable (see rag.service.js)
  embedding: { type: [Number], required: true },

  // Scoping metadata — allows one index to serve global AND scoped retrieval
  namespace: {
    type: String,
    required: true,
    enum: ["study_resource", "blog_content", "problem_metadata"],
    index: true,
  },
  // For blog-scoped retrieval: set to the blog/article _id string.
  // For global retrieval: leave null.
  scopeId: { type: String, default: null, index: true },

  // Source provenance
  sourceType: { type: String },   // "curated_link", "blog_paragraph", "problem"
  sourceUrl:  { type: String },
  sourceTitle: { type: String },

  // Topic tag (from TOPIC_TAXONOMY) for optional filtering
  topic: { type: String, index: true },

}, { timestamps: true });

// NOTE: The Atlas Vector Search index must be created via the Atlas UI or CLI,
// NOT through Mongoose. Create an index named "vector_index" on this collection
// with the following JSON definition (3072 dims for gemini-embedding-001):
//
// {
//   "mappings": {
//     "dynamic": false,
//     "fields": {
//       "embedding": { "type": "knnVector", "dimensions": 3072, "similarity": "cosine" },
//       "namespace": { "type": "filter" },
//       "scopeId":   { "type": "filter" },
//       "topic":     { "type": "filter" }
//     }
//   }
// }
// If you run WITHOUT Atlas (local dev / CI), rag.service.js automatically falls
// back to Hybrid RRF (BM25 + deterministic embeddings) — no index required.

module.exports = mongoose.model("EmbeddingChunk", embeddingChunkSchema);
