/**
 * Dense Semantic Vector Embedding & Cosine Similarity Engine
 * Upgraded from 128→384 dims (3× params) + multi-scale subword hashing + synonym expansion
 * Provides high-performance deterministic semantic projection when Gemini is unavailable.
 * 384 is the sweet spot for MiniLM-level capacity without heavy deps; collisions drop ~3× vs 128.
 */

const VECTOR_DIM = 384; // upgraded from 128 — 3× parameters, still fast

/**
 * FNV-1a 32-bit hash with seed — fast deterministic
 */
function hashString(str, seed = 0x811c9dc5) {
  let h = seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0);
}

// Secondary hash seed for subword features — reduces collision between word and n-gram spaces
const SEED_WORD = 0x811c9dc5;
const SEED_BIGRAM = 0x811c9dc5 ^ 0x9e3779b9;
const SEED_TRIGRAM = 0x811c9dc5 ^ 0x85ebca6b;
const SEED_4GRAM = 0x811c9dc5 ^ 0xc2b2ae35;

// Lightweight synonym expansion for critical system-design / CS terms.
// Hash-based models cannot learn synonyms; we inject them explicitly with reduced weight.
const SYNONYM_MAP = {
  music: ["audio"],
  audio: ["music"],
  streaming: ["playback", "hls", "adaptive"],
  playback: ["streaming"],
  link: ["url"],
  url: ["link"],
  shortening: ["shortener", "shorten"],
  shortener: ["shortening", "shorten"],
  shorten: ["shortener", "shortening"],
  ride: ["uber", "taxi", "cab"],
  hailing: ["sharing", "dispatch", "matching"],
  sharing: ["hailing"],
  taxi: ["uber", "ride"],
  cab: ["uber", "ride"],
  paxos: ["consensus", "parliament"],
  consensus: ["paxos"],
  caching: ["cache", "redis", "cdn"],
  cache: ["caching"],
  sharding: ["partition", "shard"],
  shard: ["sharding"],
  partition: ["sharding"],
  queue: ["kafka", "pubsub", "message"],
  kafka: ["queue"],
  microservice: ["microservices", "service"],
  microservices: ["microservice"],
  singleton: ["gof", "pattern"],
  factory: ["gof", "pattern"],
  observer: ["gof", "pattern"],
  decorator: ["gof", "pattern"],
};

// Domain stopwords — same as BM25, prevents "design" in every doc from washing out signal
const STOPWORDS_EMB = new Set([
  "a","about","above","after","again","against","all","am","an","and","any","are","as","at","be","because","been","before","being","below","between","both","but","by","can","cannot","could","did","do","does","doing","down","during","each","few","for","from","further","had","has","have","having","he","her","here","hers","him","his","how","i","if","in","into","is","it","its","itself","me","more","most","my","no","nor","not","of","off","on","once","only","or","other","ought","our","ours","out","over","own","same","she","should","so","some","such","than","that","the","their","them","then","there","these","they","this","those","through","to","too","under","until","up","very","was","we","were","what","when","where","which","while","who","whom","why","with","would","you","your",
  "design","system","like","based","service","services","architecture","architectural","using","via"
]);

/**
 * Generate a dense L2-normalized vector embedding for a piece of text
 * Uses unigram + bigram + high-weight char trigram/4-gram + synonym expansion.
 * @param {string} text 
 * @param {number} [dimensions=384]
 * @returns {Float32Array} Normalized dense vector
 */
function generateDeterministicEmbedding(text, dimensions = VECTOR_DIM) {
  const vec = new Float32Array(dimensions);
  if (!text || typeof text !== "string") return vec;

  const normalized = text.toLowerCase().trim().replace(/[^\w\s+#]/g, " ");
  const words = normalized.split(/\s+/).map(t=>t.trim()).filter(t=> t.length>1 && !STOPWORDS_EMB.has(t));

  // Pre-compute synonym expansions to avoid repeated map lookups
  function addTerm(term, weight, seed) {
    const h = hashString(term, seed);
    const idx = h % dimensions;
    const sign = (h & 0x80000000) ? -1 : 1;
    vec[idx] += sign * weight;
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // 1. Unigram — strongest lexical signal
    addTerm(word, 1.5, SEED_WORD);

    // Synonym expansion (reduced weight, same dim space so it bridges synonyms)
    const syns = SYNONYM_MAP[word];
    if (syns) {
      for (const syn of syns) addTerm(syn, 0.6, SEED_WORD);
    }

    // 2. Bigram — phrase semantics
    if (i < words.length - 1) {
      const bigram = `${word}_${words[i + 1]}`;
      addTerm(bigram, 1.0, SEED_BIGRAM);
    }

    // 3. Char trigrams — robustness to typos (spotoify vs spotify) — boosted from 0.4→0.8
    if (word.length >= 3) {
      for (let j = 0; j <= word.length - 3; j++) {
        const tri = word.slice(j, j + 3);
        addTerm(tri, 0.8, SEED_TRIGRAM);
      }
    }
    // 4. Char 4-grams — extra typo resilience + longer subword capture
    if (word.length >= 4) {
      for (let j = 0; j <= word.length - 4; j++) {
        const four = word.slice(j, j + 4);
        addTerm(four, 0.4, SEED_4GRAM);
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
