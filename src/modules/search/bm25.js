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
  "yourselves",
  // Domain stopwords — appear in almost every HLD title / summary, low IDF, cause noise
  "design", "system", "like", "based", "service", "services", "architecture", "architectural", "using", "via"
]);

// Synonym expansion for BM25 lexical gap (same map as embeddings.js for consistency)
const BM25_SYNONYMS = {
  music: ["audio"], audio: ["music"],
  link: ["url"], url: ["link"],
  shortening: ["shortener", "shorten"], shortener: ["shortening", "shorten"], shorten: ["shortener"],
  ride: ["uber", "taxi", "cab"], hailing: ["sharing", "dispatch"], sharing: ["hailing"], taxi: ["uber"], cab: ["uber"],
  paxos: ["consensus"], consensus: ["paxos"],
  caching: ["cache"], cache: ["caching"],
  sharding: ["partition", "shard"], shard: ["sharding"], partition: ["sharding"],
  queue: ["kafka"], kafka: ["queue"],
  microservice: ["microservices"], microservices: ["microservice"],
};

// Lightweight stemmer — handles common English suffixes so "hashing" ↔ "hash", "shortening" ↔ "shortener" share stem
function stem(word) {
  if (word.length <= 3) return word;
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("tion") && word.length > 6) return word.slice(0, -4);
  if (word.endsWith("er") && word.length > 5) return word.slice(0, -2);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 4 && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Tokenize and normalize text into clean terms — with stemming + synonym expansion for recall
 * @param {boolean} expandSynonyms - if true, adds synonym tokens alongside originals (for query side)
 */
function tokenize(text, expandSynonyms = false) {
  if (!text || typeof text !== "string") return [];
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s+#]/g, " ");

  const rawTokens = normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);

  if (!expandSynonyms) return rawTokens;

  // Expand with synonyms (query-side only, light weight) — keeps original + adds synonym stems
  const expanded = [...rawTokens];
  for (const tok of rawTokens) {
    const syns = BM25_SYNONYMS[tok];
    if (syns) {
      for (const s of syns) {
        const st = stem(s);
        if (!expanded.includes(st) && !STOPWORDS.has(st)) expanded.push(st);
      }
    }
  }
  return expanded;
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
  // Bigram Dice for typo tolerance — e.g. spotoify → spotify 0.75
  _bigramDice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.85;
    const bigrams = (s) => {
      const set = new Set();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };
    const ba = bigrams(a), bb = bigrams(b);
    let inter = 0;
    for (const bg of ba) if (bb.has(bg)) inter++;
    return (2 * inter) / (ba.size + bb.size || 1);
  }

  rank(documents, textExtractor, query) {
    if (!Array.isArray(documents) || documents.length === 0) return [];
    const queryTokens = tokenize(query, true);
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

    // Document token representations — also collect global vocab for fuzzy typo handling
    const globalVocab = new Set();
    const docData = documents.map((doc) => {
      const text = typeof textExtractor === "function" ? textExtractor(doc) : String(doc);
      const tokens = tokenize(text, false);
      totalLength += tokens.length;

      const termFreq = new Map();
      for (const t of tokens) {
        termFreq.set(t, (termFreq.get(t) || 0) + 1);
        globalVocab.add(t);
      }

      return {
        doc,
        tokens,
        length: tokens.length,
        termFreq,
      };
    });

    const avgdl = totalLength / (N || 1) || 1;

    // Document frequencies per query token — with fuzzy fallback for typos (df=0)
    const docFreq = new Map();
    const fuzzyMap = new Map(); // queryToken → vocabToken it fuzzy-matches to, or null
    for (const qToken of queryTokens) {
      let count = 0;
      for (const d of docData) {
        if (d.termFreq.has(qToken)) count++;
      }
      if (count === 0 && qToken.length >= 4) {
        // Try fuzzy: find vocab token with Dice >0.65 (handles spotoify→spotify, audoi→audio)
        let best = null, bestSim = 0;
        for (const vocab of globalVocab) {
          if (Math.abs(vocab.length - qToken.length) > 3) continue;
          const sim = this._bigramDice(qToken, vocab);
          if (sim > bestSim && sim >= 0.65) {
            bestSim = sim;
            best = vocab;
          }
        }
        if (best) {
          fuzzyMap.set(qToken, { target: best, sim: bestSim });
          // Recompute df for the fuzzy target
          let fCount = 0;
          for (const d of docData) if (d.termFreq.has(best)) fCount++;
          docFreq.set(qToken, fCount);
          continue;
        }
      }
      docFreq.set(qToken, count);
    }

    // Compute BM25 Score per document — includes fuzzy-typo weight (0.85*sim) so typos still rank
    const scored = docData.map((d, originalIndex) => {
      let score = 0;
      const matchedTokens = [];

      for (const qToken of queryTokens) {
        const n_q = docFreq.get(qToken) || 0;
        const idf = Math.log(1 + (N - n_q + 0.5) / (n_q + 0.5));
        const fuzzy = fuzzyMap.get(qToken);
        const effectiveToken = fuzzy ? fuzzy.target : qToken;
        const fuzzyWeight = fuzzy ? 0.65 + 0.35 * fuzzy.sim : 1.0; // typo penalty 0.65-1.0

        const f_q = d.termFreq.get(effectiveToken) || 0;
        if (f_q > 0) {
          matchedTokens.push(fuzzy ? `${qToken}~${effectiveToken}` : qToken);
          const numerator = f_q * (this.k1 + 1);
          const denominator = f_q + this.k1 * (1 - this.b + this.b * (d.length / avgdl));
          score += fuzzyWeight * idf * (numerator / denominator);
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
