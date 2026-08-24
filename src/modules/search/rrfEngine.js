/**
 * Hybrid Search Engine using Reciprocal Rank Fusion (RRF)
 * Combines Okapi BM25 Lexical Ranking + Dense Vector Embedding Similarity
 * 
 * Formula:
 * RRF_Score(d) = (w_bm25 / (k + rank_bm25(d))) + (w_dense / (k + rank_dense(d)))
 */

const { BM25Engine } = require("./bm25");
const { EmbeddingEngine } = require("./embeddings");
const logger = require("../../config/logger");

const DEFAULT_RRF_K = 60; // Standard TREC / Information Retrieval smoothing constant

class RRFSearchEngine {
  constructor(options = {}) {
    this.k = options.k || DEFAULT_RRF_K;
    this.wBM25 = options.wBM25 !== undefined ? options.wBM25 : 1.0;
    this.wDense = options.wDense !== undefined ? options.wDense : 1.0;
    this.bm25 = new BM25Engine(options.bm25Options);
    this.embeddings = new EmbeddingEngine(options.embeddingOptions);
  }

  /**
   * Perform Hybrid RRF Search over a document corpus
   * @param {Array<any>} documents - Corpus of documents
   * @param {Function|string} textAccessor - Function or property string to extract searchable text from document
   * @param {string} query - Search query string
   * @param {Object} [options={}] - Search tuning options (limit, minScore, weights)
   * @returns {Promise<Array<{ item: any, rrfScore: number, bm25Score: number, vectorScore: number, bm25Rank: number, vectorRank: number, matchedTokens: string[] }>>}
   */
  async search(documents, textAccessor, query, options = {}) {
    if (!Array.isArray(documents) || documents.length === 0) return [];
    const cleanQuery = (query || "").trim();

    // Text extractor helper
    const textExtractor = typeof textAccessor === "function"
      ? textAccessor
      : (doc) => (typeof textAccessor === "string" ? doc?.[textAccessor] : doc?.title || doc?.name || doc?.text || String(doc));

    // If query is empty, return original documents
    if (!cleanQuery) {
      return documents.map((doc, idx) => ({
        item: doc,
        rrfScore: 1 / (this.k + idx + 1),
        bm25Score: 0,
        vectorScore: 0,
        bm25Rank: idx + 1,
        vectorRank: idx + 1,
        matchedTokens: [],
      }));
    }

    const k = options.k || this.k;
    const wBM25 = options.wBM25 !== undefined ? options.wBM25 : this.wBM25;
    const wDense = options.wDense !== undefined ? options.wDense : this.wDense;

    // 1. Run BM25 Lexical Ranker
    const bm25Ranked = this.bm25.rank(documents, textExtractor, cleanQuery);

    // 2. Run Dense Vector Embedding Ranker
    const vectorRanked = await this.embeddings.rank(documents, textExtractor, cleanQuery);

    // 3. Map rankings by document reference/ID
    const docMap = new Map();

    // Helper key for map
    const getKey = (doc) => {
      if (doc && typeof doc === "object") {
        return doc._id ? String(doc._id) : (doc.id ? String(doc.id) : doc);
      }
      return doc;
    };

    // Populate BM25 results
    for (const b of bm25Ranked) {
      const key = getKey(b.item);
      docMap.set(key, {
        item: b.item,
        bm25Score: b.bm25Score,
        bm25Rank: b.bm25Rank,
        matchedTokens: b.matchedTokens || [],
        vectorScore: 0,
        vectorRank: documents.length + 1,
      });
    }

    // Populate Vector results
    for (const v of vectorRanked) {
      const key = getKey(v.item);
      const existing = docMap.get(key);
      if (existing) {
        existing.vectorScore = v.vectorScore;
        existing.vectorRank = v.vectorRank;
      } else {
        docMap.set(key, {
          item: v.item,
          bm25Score: 0,
          bm25Rank: documents.length + 1,
          matchedTokens: [],
          vectorScore: v.vectorScore,
          vectorRank: v.vectorRank,
        });
      }
    }

    // 4. Compute Reciprocal Rank Fusion (RRF) Scores
    const fused = [];
    for (const entry of docMap.values()) {
      const rrfBM25 = wBM25 / (k + entry.bm25Rank);
      const rrfDense = wDense / (k + entry.vectorRank);
      const totalRRF = rrfBM25 + rrfDense;

      fused.push({
        item: entry.item,
        rrfScore: Number(totalRRF.toFixed(6)),
        bm25Score: entry.bm25Score,
        vectorScore: entry.vectorScore,
        bm25Rank: entry.bm25Rank,
        vectorRank: entry.vectorRank,
        matchedTokens: entry.matchedTokens,
      });
    }

    // 5. Sort by RRF Score descending
    fused.sort((a, b) => b.rrfScore - a.rrfScore);

    // Apply limit if specified
    if (options.limit && options.limit > 0) {
      return fused.slice(0, options.limit);
    }

    return fused;
  }
}

const defaultRRFEngine = new RRFSearchEngine();

module.exports = {
  RRFSearchEngine,
  defaultRRFEngine,
  DEFAULT_RRF_K,
};
