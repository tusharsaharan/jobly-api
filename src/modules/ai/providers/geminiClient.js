const { GoogleGenAI } = require("@google/genai");
const logger = require("../../../config/logger");
const { aiCallsTotal } = require("../../../infrastructure/observability/metrics");

/**
 * Resilient Gemini invocation with automatic model fallback.
 *
 * Google rotates/deploys "-latest" aliases; any single alias can 503 for
 * minutes at a time (observed in the wild with gemini-flash-lite-latest).
 * Every AI feature in the platform routes through this helper so a model
 * blip degrades to the next model instead of failing the request.
 */

const DEFAULT_MODEL_CHAIN = [
  process.env.GEMINI_MODEL,
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
].filter(Boolean);

// Models known to have failed recently are skipped for a cooldown period.
const modelCooldown = new Map(); // model -> retryNotBefore (ms epoch)
const COOLDOWN_MS = 2 * 60 * 1000;

function getActiveChain() {
  const now = Date.now();
  const chain = DEFAULT_MODEL_CHAIN.filter((m) => {
    const until = modelCooldown.get(m) || 0;
    return until < now;
  });
  // Never return an empty chain — always allow the primary a retry.
  return chain.length > 0 ? chain : DEFAULT_MODEL_CHAIN.slice(0, 1);
}

function markCooldown(model) {
  modelCooldown.set(model, Date.now() + COOLDOWN_MS);
}

let _client = null;
function getClient(apiKey) {
  if (!_client) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

/**
 * Call Gemini generateContent with the model fallback chain.
 * @param {string} apiKey
 * @param {{ contents: string, config?: object }} request
 * @returns {Promise<string>} response text
 */
async function generateWithFallback(apiKey, request) {
  const client = getClient(apiKey);
  const chain = getActiveChain();
  let lastErr = null;

  for (const model of chain) {
    const start = Date.now();
    try {
      const response = await client.models.generateContent({
        model,
        contents: request.contents,
        config: request.config || { responseMimeType: "application/json" },
      });
      aiCallsTotal.labels(model, "generateContent", "success").inc();
      return response.text;
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.code;
      aiCallsTotal.labels(model, "generateContent", "failure").inc();
      // 404 = model retired for this key; 429/503 = transient. Both move on.
      if ([404, 429, 500, 503].includes(Number(status)) || /503|not found|overloaded/i.test(String(err?.message || ""))) {
        markCooldown(model);
        logger.warn({ model, status, err: String(err?.message || "").slice(0, 120) }, "Gemini model unavailable — falling back to next model");
        continue;
      }
      throw err; // non-transient (bad key, bad request) — fail fast
    }
  }
  throw lastErr || new Error("All Gemini models unavailable");
}

module.exports = {
  generateWithFallback,
  DEFAULT_MODEL_CHAIN,
};
