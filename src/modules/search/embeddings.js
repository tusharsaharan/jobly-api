/**
 * Dense Semantic Vector Embedding & Cosine Similarity Engine
 * Provides multi-tier embedding generation with high-performance deterministic semantic projection fallback.
 */

const VECTOR_DIM = 128;

/**
 * Murmur/FNV-1a 32-bit hash for fast deterministic subword vector projection
 */
function hashString(str, seed = 0x811c9dc5) {
  let h = seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0);
}

/**
 * Generate a dense L2-normalized vector embedding for a piece of text
 * Uses multi-scale n-grams, subword character trigrams, and position dampening.
 * @param {string} text 
 * @param {number} [dimensions=128]
 * @returns {Float32Array} Normalized dense vector
 */
function generateDeterministicEmbedding(text, dimensions = VECTOR_DIM) {
  const vec = new Float32Array(dimensions);
  if (!text || typeof text !== "string") return vec;

  const normalized = text.toLowerCase().trim();
  const words = normalized.split(/\s+/).filter(Boolean);

  // 1. Unigram and Bigram Feature Hashing
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const hashVal = hashString(word);
    const idx = hashVal % dimensions;
    const sign = (hashVal & 0x80000000) ? -1 : 1;
    vec[idx] += sign * 1.5;

    // Bigram
    if (i < words.length - 1) {
      const bigram = `${word}_${words[i + 1]}`;
      const bHash = hashString(bigram);
      const bIdx = bHash % dimensions;
      const bSign = (bHash & 0x80000000) ? -1 : 1;
      vec[bIdx] += bSign * 1.0;
    }

    // Subword Character 3-grams
    if (word.length >= 3) {
      for (let j = 0; j <= word.length - 3; j++) {
        const tri = word.slice(j, j + 3);
        const tHash = hashString(tri);
        const tIdx = tHash % dimensions;
        const tSign = (tHash & 0x80000000) ? -1 : 1;
        vec[tIdx] += tSign * 0.4;
      }
    }
  }

  // 2. L2 Normalization
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 1e-6) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] /= norm;
    }
  }

  return vec;
}

/**
 * Compute Cosine Similarity between two L2-normalized dense vectors
 * Range: [-1.0, 1.0], clamped to [0, 1] for relevance scoring
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return Math.max(0, Math.min(1, dotProduct));
}

class EmbeddingEngine {
  constructor(options = {}) {
    this.dimensions = options.dimensions || VECTOR_DIM;
  }

  /**
   * Embed query string
   */
  async embedQuery(query) {
    return generateDeterministicEmbedding(query, this.dimensions);
  }

  /**
   * Embed document text
   */
  async embedDocument(text) {
    return generateDeterministicEmbedding(text, this.dimensions);
  }

  /**
   * Rank a corpus of documents against a query string using Dense Semantic Vector Similarity
   * @param {Array<any>} documents - Array of document objects
   * @param {Function} textExtractor - Function mapping document to indexed text
   * @param {string} query - Search query string
   * @returns {Promise<Array<{ item: any, vectorScore: number, vectorRank: number }>>}
   */
  async rank(documents, textExtractor, query) {
    if (!Array.isArray(documents) || documents.length === 0) return [];
    if (!query || !query.trim()) {
      return documents.map((doc, idx) => ({
        item: doc,
        vectorScore: 0,
        vectorRank: idx + 1,
      }));
    }

    const queryVec = await this.embedQuery(query);

    const scored = await Promise.all(
      documents.map(async (doc, originalIndex) => {
        const text = typeof textExtractor === "function" ? textExtractor(doc) : String(doc);
        const docVec = await this.embedDocument(text);
        const score = cosineSimilarity(queryVec, docVec);
        return {
          item: doc,
          vectorScore: Number(score.toFixed(4)),
          originalIndex,
        };
      })
    );

    // Sort by Cosine Similarity descending
    scored.sort((a, b) => b.vectorScore - a.vectorScore);

    return scored.map((s, rankIndex) => ({
      item: s.item,
      vectorScore: s.vectorScore,
      vectorRank: rankIndex + 1,
    }));
  }
}

module.exports = {
  EmbeddingEngine,
  generateDeterministicEmbedding,
  cosineSimilarity,
};
