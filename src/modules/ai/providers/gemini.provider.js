const BaseAIProvider = require("./base.provider");
const logger = require("../../../config/logger");
const config = require("../../../config/env");
const { generateWithFallback } = require("./geminiClient");

class GeminiProvider extends BaseAIProvider {
  constructor() {
    super("Google Gemini");
    this.modelName = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  }

  async isAvailable() {
    return Boolean(config.GEMINI_API_KEY || process.env.GEMINI_API_KEY);
  }

  async generateJSON(prompt, options = {}) {
    const start = Date.now();
    const apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    try {
      const text = await generateWithFallback(apiKey, {
        contents: prompt,
        config: options.responseMimeType ? { responseMimeType: options.responseMimeType } : { responseMimeType: "application/json" },
      });
      logger.debug({ durationMs: Date.now() - start, provider: this.name }, "Gemini API call succeeded");
      return text;
    } catch (err) {
      logger.error({ err: err.message, durationMs: Date.now() - start, provider: this.name }, "Gemini API call failed");
      throw err;
    }
  }
}

module.exports = GeminiProvider;
