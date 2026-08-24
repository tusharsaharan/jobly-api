const GeminiProvider = require("./gemini.provider");
const OpenAIProvider = require("./openai.provider");
const OllamaProvider = require("./ollama.provider");
const MockRuleBasedProvider = require("./mock.provider");
const logger = require("../../../config/logger");

class ProviderFactory {
  constructor() {
    this.ollama = new OllamaProvider();
    this.gemini = new GeminiProvider();
    this.openai = new OpenAIProvider();
    this.mock = new MockRuleBasedProvider();
  }

  /**
   * Returns an ordered array of providers to try in failover cascade
   * @param {string} [preferred] Optional provider name ('ollama', 'gemini', 'openai', 'mock')
   * @returns {Promise<Array<import('./base.provider')>>}
   */
  async getProvidersCascade(preferred = null) {
    const list = [];

    if (preferred === "ollama") {
      if (await this.ollama.isAvailable()) list.push(this.ollama);
      if (await this.gemini.isAvailable()) list.push(this.gemini);
      if (await this.openai.isAvailable()) list.push(this.openai);
    } else if (preferred === "openai") {
      if (await this.openai.isAvailable()) list.push(this.openai);
      if (await this.gemini.isAvailable()) list.push(this.gemini);
      if (await this.ollama.isAvailable()) list.push(this.ollama);
    } else if (preferred === "gemini") {
      if (await this.gemini.isAvailable()) list.push(this.gemini);
      if (await this.ollama.isAvailable()) list.push(this.ollama);
      if (await this.openai.isAvailable()) list.push(this.openai);
    } else {
      // Default: If USE_LOCAL_LLM=true, prefer local Ollama first
      if (process.env.USE_LOCAL_LLM === "true" && await this.ollama.isAvailable()) {
        list.push(this.ollama);
      }
      if (await this.gemini.isAvailable()) list.push(this.gemini);
      if (await this.openai.isAvailable()) list.push(this.openai);
      if (process.env.USE_LOCAL_LLM !== "true" && await this.ollama.isAvailable()) {
        list.push(this.ollama);
      }
    }

    // Always append mock fallback at the end of the chain
    list.push(this.mock);
    return list;
  }
}

module.exports = new ProviderFactory();
