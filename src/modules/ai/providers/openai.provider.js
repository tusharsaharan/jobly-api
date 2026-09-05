const OpenAI = require("openai");
const BaseAIProvider = require("./base.provider");
const logger = require("../../../config/logger");
const { aiCallsTotal } = require("../../../infrastructure/observability/metrics");

class OpenAIProvider extends BaseAIProvider {
  constructor() {
    super("OpenAI");
    this.modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not configured");
      }
      this._client = new OpenAI({ apiKey });
    }
    return this._client;
  }

  async isAvailable() {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async generateJSON(prompt, options = {}) {
    const openai = this._getClient();
    const start = Date.now();
    const model = options.model || this.modelName;

    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: "You are an expert AI parser. You must respond ONLY with valid JSON." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });

      aiCallsTotal.labels(model, "chatCompletion", "success").inc();
      logger.debug({ durationMs: Date.now() - start, provider: this.name }, "OpenAI API call succeeded");
      return response.choices[0]?.message?.content || "{}";
    } catch (err) {
      aiCallsTotal.labels(model, "chatCompletion", "failure").inc();
      logger.error({ err: err.message, durationMs: Date.now() - start, provider: this.name }, "OpenAI API call failed");
      throw err;
    }
  }
}

module.exports = OpenAIProvider;
