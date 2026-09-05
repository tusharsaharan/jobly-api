const BaseAIProvider = require("./base.provider");
const logger = require("../../../config/logger");
const config = require("../../../config/env");
const { aiCallsTotal } = require("../../../infrastructure/observability/metrics");

class OllamaProvider extends BaseAIProvider {
  constructor() {
    super("Local Ollama");
    this.host = process.env.OLLAMA_HOST || "http://localhost:11434";
    this.modelName = process.env.OLLAMA_MODEL || "qwen2.5:3b-instruct";
  }

  /**
   * Health check: probe Ollama server tags endpoint
   */
  async isAvailable() {
    // If explicitly disabled or no local LLM preference, return false
    if (process.env.USE_LOCAL_LLM === "false") return false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const res = await fetch(`${this.host}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      return res.ok;
    } catch (e) {
      logger.debug({ err: e.message, host: this.host }, "Ollama provider unavailable");
      return false;
    }
  }

  /**
   * Generate structured JSON output via Ollama /api/generate
   */
  async generateJSON(prompt, options = {}) {
    const start = Date.now();
    const model = options.model || this.modelName;

    try {
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs || 30000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${this.host}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          format: "json",
          stream: false,
          options: {
            temperature: options.temperature || 0.1,
            num_predict: options.maxTokens || 2048,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Ollama HTTP error ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const rawText = data.response;

      if (aiCallsTotal?.labels) {
        aiCallsTotal.labels(model, "generateContent", "success").inc();
      }
      logger.debug({ durationMs: Date.now() - start, provider: this.name, model }, "Ollama local inference succeeded");

      return rawText;
    } catch (err) {
      if (aiCallsTotal?.labels) {
        aiCallsTotal.labels(model, "generateContent", "failure").inc();
      }
      logger.error({ err: err.message, durationMs: Date.now() - start, provider: this.name }, "Ollama local inference failed");
      throw err;
    }
  }
}

module.exports = OllamaProvider;
