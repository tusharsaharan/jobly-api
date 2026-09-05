/**
 * Abstract Base Class for LLM Providers
 */
class BaseAIProvider {
  constructor(name) {
    if (new.target === BaseAIProvider) {
      throw new TypeError("Cannot construct BaseAIProvider instances directly");
    }
    this.name = name;
  }

  /**
   * @param {string} prompt
   * @param {object} options
   * @returns {Promise<string>} Raw JSON or text string from the model
   */
  async generateJSON(prompt, options = {}) {
    throw new Error(`generateJSON() not implemented in ${this.name}`);
  }

  /**
   * Health check / availability check for the provider
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return false;
  }
}

module.exports = BaseAIProvider;
