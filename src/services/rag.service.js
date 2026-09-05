/**
 * RAG Service — Retrieval-Augmented Generation Infrastructure
 *
 * Provides:
 *   1. embed(text)            — convert text to a 3072-dim vector via Gemini
 *   2. ingestChunks(chunks)   — embed and store chunks into EmbeddingChunk collection
 *   3. retrieve(query, opts)  — vector search with optional namespace/scope filtering
 *   4. ragAnswer(query, chunks, opts) — generate an LLM answer grounded in retrieved chunks
 *
 * Supports both:
 *   - Global retrieval:    retrieve("OS scheduling", { namespace: "study_resource" })
 *   - Blog-scoped retrieval: retrieve("what is CAP", { namespace: "blog_content", scopeId: "articleId" })
 */

const { GoogleGenAI } = require("@google/genai");
const EmbeddingChunk = require("../models/EmbeddingChunk");
const logger = require("../config/logger");
const { RRFSearchEngine } = require("../modules/search/rrfEngine");

// ── Constants ────────────────────────────────────────────────────

const EMBEDDING_MODEL = "gemini-embedding-001";  // 3072-dim, available on v1beta
const EMBEDDING_DIM = 3072;
const GENERATION_MODEL = "gemini-flash-lite-latest";

// Hybrid RRF engine used when Atlas Vector Search is unavailable (local dev / CI).
// Uses BM25 + 384-dim deterministic embeddings (3× params vs 128) — no external API required.
const hybridEngine = new RRFSearchEngine({ k: 60, wBM25: 1.0, wDense: 1.0, embeddingOptions: { dimensions: 384 } });

// ── Lazy-init AI client ─────────────────────────────────────────

let _ai = null;
function hasValidGeminiKey() {
  const k = process.env.GEMINI_API_KEY;
  return Boolean(k && !String(k).includes("your_gemini_api_key") && String(k).trim().length > 10);
}
function getAI() {
  if (!_ai) {
    if (!hasValidGeminiKey()) throw new Error("GEMINI_API_KEY not set");
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _ai;
}

// ── Embedding ───────────────────────────────────────────────────

/**
 * Convert a text string into a 3072-dimensional embedding vector.
 * Uses Gemini gemini-embedding-001.
 * @param {string} text
 * @returns {Promise<number[]>} float[3072]
 */
async function embed(text) {
  const result = await getAI().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  return result.embeddings[0].values;
}

// ── Ingestion ───────────────────────────────────────────────────

/**
 * Embed and store an array of content chunks.
 *
 * @param {Array<{
 *   content: string,
 *   namespace: "study_resource"|"blog_content"|"problem_metadata",
 *   scopeId?: string,
 *   sourceType?: string,
 *   sourceUrl?: string,
 *   sourceTitle?: string,
 *   topic?: string
 * }>} chunks
 * @returns {Promise<number>} Number of chunks inserted
 */
async function ingestChunks(chunks) {
  const BATCH_SIZE = 20; // stay under Gemini rate limits
  let inserted = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    // Embed all content in the batch
    const embeddings = await Promise.all(batch.map((c) => embed(c.content)));

    const docs = batch.map((c, j) => ({
      content:     c.content,
      embedding:   embeddings[j],
      namespace:   c.namespace,
      scopeId:     c.scopeId || null,
      sourceType:  c.sourceType || null,
      sourceUrl:   c.sourceUrl || null,
      sourceTitle: c.sourceTitle || null,
      topic:       c.topic || null,
    }));

    await EmbeddingChunk.insertMany(docs);
    inserted += docs.length;

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  logger.info({ inserted }, "RAG ingestion complete");
  return inserted;
}

// ── Retrieval ───────────────────────────────────────────────────

/**
 * Perform a vector similarity search.
 * Priority: Atlas Vector Search → Hybrid RRF (BM25 + deterministic embeddings).
 * The hybrid path requires NO Atlas index and NO Gemini key — ideal for local dev & CI.
 *
 * @param {string} query            The user query
 * @param {object} opts
 * @param {"study_resource"|"blog_content"|"problem_metadata"} opts.namespace  Required
 * @param {string} [opts.scopeId]   For blog-scoped retrieval
 * @param {string} [opts.topic]     Optional topic filter
 * @param {number} [opts.topK=5]    How many results to return
 * @returns {Promise<Array<{content, sourceUrl, sourceTitle, topic, score}>>}
 */
async function retrieve(query, { namespace, scopeId = null, topic = null, topK = 5 }) {
  // Build filter for Atlas Vector Search
  const filter = {};
  if (namespace) filter.namespace = namespace;
  if (scopeId)   filter.scopeId = scopeId;
  if (topic)     filter.topic = topic;

  // 1) Try Atlas Vector Search (requires Atlas index + valid GEMINI_API_KEY)
  if (hasValidGeminiKey()) {
    try {
      const queryEmbedding = await embed(query);

      const results = await EmbeddingChunk.aggregate([
        {
          $vectorSearch: {
            index: "vector_index",
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: topK * 10,
            limit: topK,
            filter: filter,
          },
        },
        {
          $project: {
            content: 1,
            sourceUrl: 1,
            sourceTitle: 1,
            topic: 1,
            namespace: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ]);

      if (results && results.length > 0) {
        logger.info({ namespace, topK, hits: results.length }, "Atlas vector search succeeded");
        return results;
      }
      logger.info("Atlas vector search returned 0 results, trying Hybrid RRF");
    } catch (err) {
      logger.warn({ err: err.message }, "Atlas vector retrieval failed, falling back to Hybrid RRF");
    }
  } else {
    logger.debug("GEMINI_API_KEY not set — skipping Atlas vector search, using Hybrid RRF directly");
  }

  // 2) Fallback: Hybrid RRF (BM25 + deterministic embeddings) — no Atlas, no API key needed
  return hybridFallbackSearch(query, { namespace, scopeId, topic, topK });
}

/**
 * Hybrid RRF fallback when Atlas Vector Search is unavailable.
 * Combines BM25 lexical ranking + deterministic dense embeddings via RRF (k=60).
 * No Gemini key, no Atlas index required — works fully offline.
 */
async function hybridFallbackSearch(query, { namespace, scopeId, topic, topK }) {
  const cleaned = String(query || "").trim();
  // Hard guard: empty / single-char / only symbols → no retrieval (controller already 400, but rag direct call should also be safe)
  if (cleaned.length < 2 || cleaned.replace(/[^a-zA-Z0-9]/g, "").length < 2) return [];
  // Block obvious injection / XSS payloads from polluting retrieval (still log, return none)
  if (/<script|DROP\s+TABLE|SELECT\s+\*|INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+.*SET/i.test(cleaned)) return [];

  const filter = {};
  if (namespace) filter.namespace = namespace;
  if (scopeId)   filter.scopeId = scopeId;
  if (topic)     filter.topic = topic;

  const docs = await EmbeddingChunk.find(filter)
    .select("content sourceUrl sourceTitle topic namespace scopeId")
    .lean();

  if (docs.length === 0) return [];

  // Boost title 3× (so query matching title outranks body-only matches); topic gets 1×
  const textAccessor = (doc) => `${doc.sourceTitle || ""} ${doc.sourceTitle || ""} ${doc.sourceTitle || ""} ${doc.topic || ""} ${doc.content || ""}`;

  const rrfResults = await hybridEngine.search(docs, textAccessor, query, { limit: Math.max(topK * 3, topK) });
  if (rrfResults.length === 0) return [];

  // Absolute off-topic guard: if even the best doc has no lexical and weak semantic, it's junk/Hindi/burger
  const maxBm25 = Math.max(...rrfResults.map(r => r.bm25Score));
  const maxVector = Math.max(...rrfResults.map(r => r.vectorScore));
  // Require at least one strong signal: BM25≥1.0 (lexical) OR vector≥0.28 (semantic)
  if (maxBm25 < 1.0 && maxVector < 0.28) {
    logger.debug({ query: cleaned.slice(0,60), maxBm25, maxVector }, "Hybrid RRF off-topic → no results");
    return [];
  }

  // CS relevance guard: query must contain at least one CS/system-design token (otherwise burger/Hindi → none)
  // Build CS vocab from doc titles/topics + canonical taxonomy (so Arrays, DP etc. are CS even if not in current docs)
  const csStop = new Set(["make","get","give","take","use","need","want","like","know","tell","explain","describe","give","show","help","with","about","how","what","why","when","where","which","who","can","you","me","my","i","we","our","it","its","this","that"]);
  const titleTopicTokens = new Set();
  for (const d of docs) {
    const t = `${d.sourceTitle || ""} ${d.topic || ""}`.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).map(s=> s.trim()).filter(s=> s.length>2 && !csStop.has(s));
    for (const tok of t) titleTopicTokens.add(tok);
    // Also add stemmed
    for (const tok of t) {
      let st = tok;
      if (st.endsWith("ing") && st.length>5) st = st.slice(0,-3);
      else if (st.endsWith("s") && st.length>4) st = st.slice(0,-1);
      if (st.length>2) titleTopicTokens.add(st);
    }
  }
  // Add canonical taxonomy terms (so Arrays, DP, OS etc. are CS even if not in current embedding docs)
  try {
    const { getTopicNames } = require("../constants/topicTaxonomy");
    for (const t of getTopicNames()) {
      const parts = t.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).map(s=> s.trim()).filter(s=> s.length>2);
      for (const p of parts) {
        titleTopicTokens.add(p);
        let st = p;
        if (st.endsWith("ing") && st.length>5) st = st.slice(0,-3);
        else if (st.endsWith("s") && st.length>4) st = st.slice(0,-1);
        if (st.length>2) titleTopicTokens.add(st);
      }
    }
  } catch {}
  const OFFTOPIC_BLOCK = new Set(["burger","cheese","recipe","pasta","cook","food","cricket","tujhe","kuch","nhi","aata","yeh","kya","hai","samjhao","make","me"]);
  const queryTokensForCsRaw = cleaned.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).map(s=> s.trim()).filter(s=> s.length>2 && !csStop.has(s));
  // Filter out known off-topic food/Hindi tokens before CS check (so burger recipe cheese → 0 CS)
  const queryTokensForCs = queryTokensForCsRaw.filter(t => !OFFTOPIC_BLOCK.has(t));
  // If after filtering food, no tokens left → check if original had only food/Hindi → off-topic
  const hasFoodOnly = queryTokensForCsRaw.length>0 && queryTokensForCs.length===0;
  if (hasFoodOnly) {
    logger.debug({ query: cleaned.slice(0,60), queryTokensForCsRaw }, "Hybrid RRF food/Hindi only → off-topic");
    return [];
  }
  const hasCsToken = queryTokensForCs.some(qt => {
    if (titleTopicTokens.has(qt)) return true;
    // stem check
    let st = qt;
    if (st.endsWith("ing") && st.length>5) st = st.slice(0,-3);
    else if (st.endsWith("s") && st.length>4) st = st.slice(0,-1);
    if (titleTopicTokens.has(st)) return true;
    // synonym check (link→url etc.)
    const synMap = { music:"audio", audio:"music", link:"url", url:"link", shortening:"shorten", shortener:"shorten", ride:"uber", uber:"ride", paxos:"consensus", consensus:"paxos", caching:"cache", cache:"caching", sharding:"partition", partition:"sharding" };
    const syn = synMap[qt];
    if (syn && titleTopicTokens.has(syn)) return true;
    // typo fuzzy for CS: allow ubber→uber, geospacial→geospatial, spotoify→spotify (edit distance via bigram ≥0.75 for len≥5)
    if (qt.length >= 4) {
      for (const csTok of titleTopicTokens) {
        if (Math.abs(csTok.length - qt.length) > 2) continue;
        if (csTok.length < 4) continue;
        const bigrams = s => { const set=new Set(); for(let i=0;i<s.length-1;i++) set.add(s.slice(i,i+2)); return set; };
        const a=bigrams(qt), b=bigrams(csTok);
        let inter=0; for(const bg of a) if(b.has(bg)) inter++;
        const dice=(2*inter)/(a.size+b.size||1);
        // Stricter for short words to avoid cheese→chess (dice 0.75 but cheese is food, already filtered)
        const thresh = qt.length <=5 ? 0.80 : 0.70;
        if (dice >= thresh) return true;
      }
    }
    return false;
  });
  if (!hasCsToken) {
    logger.debug({ query: cleaned.slice(0,60), queryTokensForCs }, "Hybrid RRF no CS token → off-topic");
    return [];
  }

  // Keep only results with meaningful signal
  const filtered = rrfResults.filter(r => r.bm25Score >= 1.0 || r.vectorScore >= 0.22);
  const chosenRaw = (filtered.length > 0 ? filtered : rrfResults.filter(r => r.bm25Score > 0 || r.vectorScore > 0.12)).slice(0, topK);
  if (chosenRaw.length === 0) return [];

  // Absolute discriminative score: blend normalized BM25 and vector, not relative RRF rank.
  // This keeps off-topic low (<0.22) and on-topic high (>0.55).
  const maxBm25Chosen = Math.max(...chosenRaw.map(r => r.bm25Score), 1);
  return chosenRaw.map((r) => {
    const normBm25 = Math.min(1, r.bm25Score / maxBm25Chosen); // 0-1
    const abs = normBm25 * 0.55 + r.vectorScore * 0.45; // lexical 55% + semantic 45%
    // Map abs (0-1) → 0.18-0.98 for UI, but keep off-topic <0.22
    const score = Math.min(0.98, parseFloat((0.18 + abs * 0.80).toFixed(3)));
    return {
      content: r.item.content,
      sourceUrl: r.item.sourceUrl,
      sourceTitle: r.item.sourceTitle,
      topic: r.item.topic,
      namespace: r.item.namespace,
      score,
      _debug: { rrfScore: r.rrfScore, bm25Score: r.bm25Score, vectorScore: r.vectorScore },
    };
  });
}

// Kept for backwards-compat (tests may stub fallbackTextSearch); delegates to hybrid
async function fallbackTextSearch(query, opts) {
  return hybridFallbackSearch(query, opts);
}

// ── Generation (RAG completion) ─────────────────────────────────

const MIN_CONFIDENCE_SCORE = 0.22; // Hybrid RRF produces calibrated scores; 0.22 filters noise while keeping recall

/**
 * Generate an LLM answer grounded in retrieved chunks.
 *
 * @param {string} query              The user question
 * @param {Array}  retrievedChunks    Output from retrieve()
 * @param {object} [opts]
 * @param {string} [opts.systemPrompt]  Extra system-level instruction
 * @returns {Promise<{reply: string, sources: Array, confidence: string}>}
 */
async function ragAnswer(query, retrievedChunks, { systemPrompt = "" } = {}) {
  // No results or all scores too low → graceful fallback
  if (
    !retrievedChunks ||
    retrievedChunks.length === 0 ||
    (retrievedChunks[0]?.score !== undefined && retrievedChunks[0].score < MIN_CONFIDENCE_SCORE)
  ) {
    return {
      reply:
        "I could not find directly relevant curriculum material for this specific query in the local knowledge base. " +
        "Please check your keywords or explore our comprehensive System Design Problem Sheets and Landmark Papers.",
      sources: [],
      confidence: "none",
    };
  }

  // Structured context injection
  const contextBlock = retrievedChunks
    .map(
      (c, i) =>
        `[Source ${i + 1}: "${c.sourceTitle || "Unknown"}" — ${c.sourceUrl || "No URL"}]\n${c.content}`
    )
    .join("\n\n---\n\n");

  const defaultOraclePrompt =
    "You are the authoritative Jobly System Design & Technical Architecture Oracle — an elite Principal Distributed Systems Architect. " +
    "Synthesize an exhaustive, beautifully formatted, production-grade system design answer to the user's question, strictly grounded in computer science fundamentals and the curriculum reference material provided below. " +
    "Present a structured breakdown including: \n" +
    "1) **System Overview & Requirements** (Functional & Non-Functional: Latency, Availability, Consistency, Scale).\n" +
    "2) **Capacity Estimation** (Traffic QPS, Storage & Bandwidth estimates).\n" +
    "3) **High-Level Architecture & Core Components** (Client, Edge/CDN, API Gateway, Microservices, Caching Layer, Databases, Blob Storage, Message Queues).\n" +
    "4) **Data Model & Database Architecture** (SQL vs NoSQL vs In-Memory, Sharding keys).\n" +
    "5) **Deep-Dive Engineering Mechanics** (Domain-specific pipelines such as audio/video chunking, geospatial indexing, fanout, or consensus algorithms).\n" +
    "6) **Reliability, Fault Tolerance & Caching Strategies**.\n" +
    "Always cite the verified reference materials using [Source N].";

  const prompt = `${systemPrompt ? systemPrompt + "\n\n" : defaultOraclePrompt + "\n\n"}Reference Material:
${contextBlock}

User Question: ${query}

Instructions:
- Provide an in-depth, structured, clear technical response.
- Reference the sources with [Source 1], [Source 2], etc.
- If referencing URLs, use the verified source URLs from the reference material above.`;

  const topScore = retrievedChunks[0]?.score ?? 0;
  const sources = retrievedChunks.map((c) => ({
    title: c.sourceTitle,
    url: c.sourceUrl,
    score: c.score,
  }));
  const confidence = topScore > 0.55 ? "high" : topScore > 0.30 ? "medium" : "low";

  // If no valid Gemini key, return grounded template synthesis (no LLM call) — still cited
  if (!hasValidGeminiKey()) {
    const synthesis = retrievedChunks
      .map((c, i) => `**[Source ${i + 1}: ${c.sourceTitle || "Curriculum"}]** — ${c.content.slice(0, 600)}${c.content.length > 600 ? "…" : ""}`)
      .join("\n\n");
    return {
      reply:
        `**Grounded Answer (offline synthesis — LLM key not configured)**\n\n` +
        `Question: "${query}"\n\n` +
        `${synthesis}\n\n` +
        `**Guidance**: The above is synthesized from verified curriculum sources [Source 1..${retrievedChunks.length}]. For a fully LLM-polished architectural narrative, configure \`GEMINI_API_KEY\`.`,
      sources,
      confidence,
    };
  }

  try {
    const { generateWithFallback } = require("../modules/ai/providers/geminiClient");
    const replyText = await generateWithFallback(process.env.GEMINI_API_KEY, {
      contents: prompt,
      config: undefined, // plain markdown reply
    });
    return { reply: replyText, sources, confidence };
  } catch (err) {
    logger.warn({ err: err.message }, "RAG generation failed, falling back to offline synthesis");
    const synthesis = retrievedChunks
      .map((c, i) => `**[Source ${i + 1}: ${c.sourceTitle || "Curriculum"}]** — ${c.content.slice(0, 600)}${c.content.length > 600 ? "…" : ""}`)
      .join("\n\n");
    return {
      reply:
        `**Grounded Answer (fallback synthesis)**\n\n` +
        `Question: "${query}"\n\n` +
        `${synthesis}\n\n` +
        `(LLM generation unavailable: ${err.message})`,
      sources,
      confidence,
    };
  }
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = {
  embed,
  ingestChunks,
  retrieve,
  ragAnswer,
  fallbackTextSearch,
  hybridFallbackSearch,
  EMBEDDING_DIM,
};
