const GeminiProvider = require("./gemini.provider");
const OpenAIProvider = require("./openai.provider");
const MockRuleBasedProvider = require("./mock.provider");
const logger = require("../../../config/logger");

class ProviderFactory {
  constructor() {
    this.gemini = new GeminiProvider();
    this.openai = new OpenAIProvider();
    this.mock = new MockRuleBasedProvider();
  }

  /**
   * Returns an ordered array of providers to try in failover cascade
   * @param {string} [preferred] Optional provider name ('gemini', 'openai', 'mock')
   * @returns {Promise<Array<import('./base.provider')>>}
   */
  async getProvidersCascade(preferred = null) {
    const list = [];

    if (preferred === "openai") {
      if (await this.openai.isAvailable()) list.push(this.openai);
      if (await this.gemini.isAvailable()) list.push(this.gemini);
    } else if (preferred === "gemini") {
      if (await this.gemini.isAvailable()) list.push(this.gemini);
      if (await this.openai.isAvailable()) list.push(this.openai);
    } else {
      // Default production preference: Gemini -> OpenAI
      if (await this.gemini.isAvailable()) list.push(this.gemini);
      if (await this.openai.isAvailable()) list.push(this.openai);
    }

    // Always append mock fallback at the end of the chain
    list.push(this.mock);
    return list;
  }
}

module.exports = new ProviderFactory();
