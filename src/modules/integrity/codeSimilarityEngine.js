const crypto = require("crypto");

/**
 * Token Types for Language-Agnostic Structural AST Tokenization
 */
const KEYWORDS = new Set([
  "if", "else", "elif", "for", "while", "do", "switch", "case", "default",
  "return", "break", "continue", "function", "def", "class", "struct",
  "public", "private", "protected", "static", "final", "const", "let", "var",
  "try", "catch", "finally", "throw", "import", "export", "from", "require",
  "new", "delete", "typeof", "instanceof", "async", "await", "yield",
  "true", "false", "null", "undefined", "nil", "none", "in", "is", "not", "and", "or"
]);

/**
 * 1. Tokenize source code into abstract structural tokens
 * Normalizes all user-defined identifiers (variable and function names) to 'IDENT'
 * and all numeric literals to 'NUM', making the fingerprint invariant to renaming.
 */
function tokenizeSourceCode(code = "") {
  if (typeof code !== "string") return [];

  // 1. Strip comments and string literals
  const cleanCode = code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/#.*$/gm, " ")
    .replace(/(["'`])(?:\\.|[^\\])*?\1/g, " STR ");

  // 2. Lexical token extraction regex
  const tokenRegex = /[A-Za-z_$][\w$]*|[0-9]+(?:\.[0-9]+)?|[+\-*/%=!<>]=?|&&|\|\||[{}()[\],;.]/g;
  const rawTokens = cleanCode.match(tokenRegex) || [];

  const tokens = [];
  for (const t of rawTokens) {
    const lower = t.toLowerCase();
    if (KEYWORDS.has(lower)) {
      tokens.push(`KW_${lower.toUpperCase()}`);
    } else if (/^[0-9]+(?:\.[0-9]+)?$/.test(t)) {
      tokens.push("NUM");
    } else if (t === "STR") {
      tokens.push("STR");
    } else if (/^[A-Za-z_$][\w$]*$/.test(t)) {
      tokens.push("IDENT");
    } else {
      tokens.push(`OP_${t}`);
    }
  }

  return tokens;
}

/**
 * 2. Rabin-Karp Polynomial Rolling Hash for k-grams
 * Computes 32-bit integer hashes for shingle tokens of length k
 */
function computeRabinKarpHashes(tokens, k = 5) {
  if (tokens.length < k) return [];

  const B = 31; // Base prime
  const M = 1000000007; // Modulo prime

  // Map each unique token string to an integer ID
  const tokenMap = new Map();
  let nextId = 1;
  const tokenIds = tokens.map((t) => {
    if (!tokenMap.has(t)) {
      tokenMap.set(t, nextId++);
    }
    return tokenMap.get(t);
  });

  const hashes = [];

  // Compute power B^(k-1) % M
  let bPow = 1;
  for (let i = 0; i < k - 1; i++) {
    bPow = (bPow * B) % M;
  }

  // Initial hash for first k tokens
  let currentHash = 0;
  for (let i = 0; i < k; i++) {
    currentHash = (currentHash * B + tokenIds[i]) % M;
  }
  hashes.push({ hash: currentHash, position: 0 });

  // Rolling hash over remaining window
  for (let i = k; i < tokenIds.length; i++) {
    // Remove leading token and add new trailing token
    const leadingVal = (tokenIds[i - k] * bPow) % M;
    currentHash = (currentHash - leadingVal + M) % M;
    currentHash = (currentHash * B + tokenIds[i]) % M;
    hashes.push({ hash: currentHash, position: i - k + 1 });
  }

  return hashes;
}

/**
 * 3. Winnowing Algorithm
 * Selects the minimum hash within each sliding window of size w
 * Guarantee: in any substring of length (w + k - 1), at least one fingerprint is picked.
 */
function winnow(hashes, w = 4) {
  if (hashes.length === 0) return new Set();
  if (hashes.length <= w) {
    let minItem = hashes[0];
    for (let i = 1; i < hashes.length; i++) {
      if (hashes[i].hash <= minItem.hash) {
        minItem = hashes[i];
      }
    }
    return new Set([minItem.hash]);
  }

  const fingerprints = new Set();
  let minIndex = -1;

  for (let i = 0; i <= hashes.length - w; i++) {
    const window = hashes.slice(i, i + w);
    let minItem = window[0];
    let minPos = i;

    // Rightmost minimum tie-breaking
    for (let j = 1; j < window.length; j++) {
      if (window[j].hash <= minItem.hash) {
        minItem = window[j];
        minPos = i + j;
      }
    }

    if (minPos !== minIndex) {
      minIndex = minPos;
      fingerprints.add(minItem.hash);
    }
  }

  return fingerprints;
}

/**
 * 4. Generate Document Fingerprints
 */
function generateCodeFingerprints(code, k = 5, w = 4) {
  const tokens = tokenizeSourceCode(code);
  const hashes = computeRabinKarpHashes(tokens, k);
  return winnow(hashes, w);
}

/**
 * 5. Compute Jaccard Similarity between two sets of fingerprints
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
function calculateJaccardSimilarity(fingerprintsA, fingerprintsB) {
  const setA = fingerprintsA instanceof Set ? fingerprintsA : new Set(fingerprintsA);
  const setB = fingerprintsB instanceof Set ? fingerprintsB : new Set(fingerprintsB);

  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionSize++;
    }
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : Math.round((intersectionSize / unionSize) * 1000) / 1000;
}

/**
 * 6. Plagiarism & Structural Similarity Detector
 * Compares candidate submission against reference solutions or other submissions
 */
function detectPlagiarism({ candidateCode = "", referenceCorpus = [], threshold = 0.65 }) {
  const candidateFingerprints = generateCodeFingerprints(candidateCode);

  let maxSimilarity = 0;
  let matchedIndex = -1;
  let matchedTitle = null;

  for (let i = 0; i < referenceCorpus.length; i++) {
    const ref = referenceCorpus[i];
    const refCode = typeof ref === "string" ? ref : ref.code || "";
    const refFingerprints = generateCodeFingerprints(refCode);
    const sim = calculateJaccardSimilarity(candidateFingerprints, refFingerprints);

    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      matchedIndex = i;
      matchedTitle = typeof ref === "object" ? ref.title || `Solution #${i + 1}` : `Reference #${i + 1}`;
    }
  }

  const isFlagged = maxSimilarity >= threshold;

  return {
    isFlagged,
    maxSimilarity,
    matchedIndex: isFlagged ? matchedIndex : null,
    matchedTitle: isFlagged ? matchedTitle : null,
    fingerprintCount: candidateFingerprints.size,
    threshold,
  };
}

module.exports = {
  tokenizeSourceCode,
  computeRabinKarpHashes,
  winnow,
  generateCodeFingerprints,
  calculateJaccardSimilarity,
  detectPlagiarism,
};
