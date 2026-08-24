/**
 * Okapi BM25 Lexical Scoring Engine
 * Standard parameters: k1 = 1.2 (term frequency saturation), b = 0.75 (document length penalization)
 */

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't",
  "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have",
  "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself",
  "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into",
  "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our",
  "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's",
  "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs",
  "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
  "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't",
  "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's",
  "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't",
  "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself",
  "yourselves"
]);

/**
 * Tokenize and normalize text into clean terms
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s+#]/g, " ");

  const rawTokens = normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

  return rawTokens;
}

class BM25Engine {
  constructor(options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
  }

  /**
   * Rank a corpus of documents against a query string using Okapi BM25
   * @param {Array<any>} documents - Array of document objects
   * @param {Function} textExtractor - Function mapping document to indexed text
   * @param {string} query - Search query string
   * @returns {Array<{ item: any, bm25Score: number, bm25Rank: number, matchedTokens: string[] }>}
   */
  rank(documents, textExtractor, query) {
    if (!Array.isArray(documents) || documents.length === 0) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return documents.map((doc, idx) => ({
        item: doc,
        bm25Score: 0,
        bm25Rank: idx + 1,
        matchedTokens: [],
      }));
    }

    const N = documents.length;
    let totalLength = 0;

    // Document token representations
    const docData = documents.map((doc) => {
      const text = typeof textExtractor === "function" ? textExtractor(doc) : String(doc);
      const tokens = tokenize(text);
      totalLength += tokens.length;

      const termFreq = new Map();
      for (const t of tokens) {
        termFreq.set(t, (termFreq.get(t) || 0) + 1);
      }

      return {
        doc,
        tokens,
        length: tokens.length,
        termFreq,
      };
    });

    const avgdl = totalLength / (N || 1) || 1;

    // Document frequencies per query token
    const docFreq = new Map();
    for (const qToken of queryTokens) {
      let count = 0;
      for (const d of docData) {
        if (d.termFreq.has(qToken)) count++;
      }
      docFreq.set(qToken, count);
    }

    // Compute BM25 Score per document
    const scored = docData.map((d, originalIndex) => {
      let score = 0;
      const matchedTokens = [];

      for (const qToken of queryTokens) {
        const n_q = docFreq.get(qToken) || 0;
        // Robertson-Spärck Jones IDF formula with add-1 smoothing
        const idf = Math.log(1 + (N - n_q + 0.5) / (n_q + 0.5));

        const f_q = d.termFreq.get(qToken) || 0;
        if (f_q > 0) {
          matchedTokens.push(qToken);
          const numerator = f_q * (this.k1 + 1);
          const denominator = f_q + this.k1 * (1 - this.b + this.b * (d.length / avgdl));
          score += idf * (numerator / denominator);
        }
      }

      return {
        item: d.doc,
        bm25Score: Math.max(0, Number(score.toFixed(4))),
        matchedTokens,
        originalIndex,
      };
    });

    // Sort by BM25 Score descending
    scored.sort((a, b) => b.bm25Score - a.bm25Score);

    return scored.map((s, rankIndex) => ({
      item: s.item,
      bm25Score: s.bm25Score,
      bm25Rank: rankIndex + 1,
      matchedTokens: s.matchedTokens,
    }));
  }
}

module.exports = {
  BM25Engine,
  tokenize,
};
