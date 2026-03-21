const { GoogleGenAI } = require("@google/genai");
const BaseAIProvider = require("./base.provider");
const logger = require("../../../config/logger");
const config = require("../../../config/env");
const { aiCallsTotal } = require("../../../infrastructure/observability/metrics");

class GeminiProvider extends BaseAIProvider {
  constructor() {
    super("Google Gemini");
    this.modelName = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      const apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured");
      }
      this._client = new GoogleGenAI({ apiKey });
    }
    return this._client;
  }

  async isAvailable() {
    return Boolean(config.GEMINI_API_KEY || process.env.GEMINI_API_KEY);
  }

  async generateJSON(prompt, options = {}) {
    const ai = this._getClient();
    const start = Date.now();
    const model = options.model || this.modelName;

    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      aiCallsTotal.labels(model, "generateContent", "success").inc();
      logger.debug({ durationMs: Date.now() - start, provider: this.name }, "Gemini API call succeeded");
      return response.text;
    } catch (err) {
      aiCallsTotal.labels(model, "generateContent", "failure").inc();
      logger.error({ err: err.message, durationMs: Date.now() - start, provider: this.name }, "Gemini API call failed");
      throw err;
    }
  }
}

module.exports = GeminiProvider;
