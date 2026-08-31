const { z } = require("zod");
const aiService = require("../modules/ai/aiService");
const logger = require("../config/logger");

const deiResponseSchema = z.object({
  rewrittenDescription: z.string(),
  improvements: z.array(
    z.object({
      originalPhrase: z.string(),
      replacementPhrase: z.string(),
      reason: z.string()
    })
  ),
  summary: z.string()
});

class DeiService {
  /**
   * Rewrite a job description to be more inclusive and DEI-friendly
   */
  async rewriteForDei(title, description) {
    if (!description || description.trim().length < 20) {
      throw new Error("Job description is too short to optimize for DEI.");
    }

    try {
      const prompt = `
You are an expert Diversity, Equity, and Inclusion (DEI) talent acquisition consultant.
Your mission is to rewrite the provided job description to remove biased, gender-coded, or exclusionary language while preserving all authentic role responsibilities and technical expectations.

Key DEI Guidelines:
1. Replace hyper-masculine/aggressive jargon ('rockstar', 'ninja', 'crush it', 'killer instincts', 'dominant') with clear, professional capability terms ('skilled specialist', 'collaborative contributor').
2. Replace 'culture fit' with 'culture add' or 'values alignment'.
3. Remove subtle age-exclusionary phrases ('digital native', 'recent grads only', 'high-energy youthful culture').
4. Balance assertive and communal language to encourage broader candidate application rates.
5. Keep the formatting clean (bullet points, clear sections).
6. Do not use any emojis.

Job Title: ${title || "Position"}
Original Job Description:
"""
${String(description).slice(0, 4000)}
"""

Return strictly a JSON object matching this schema:
{
  "rewrittenDescription": "string (the full updated markdown description)",
  "improvements": [
    {
      "originalPhrase": "string",
      "replacementPhrase": "string",
      "reason": "string explaining why this promotes inclusion"
    }
  ],
  "summary": "short 1-2 sentence overview of improvements made"
}
`;

      const result = await aiService.executeWithCascade(prompt, deiResponseSchema, {
        preferredProvider: "gemini",
        temperature: 0.2
      });

      if (!result.data || !result.data.rewrittenDescription) {
        throw new Error("Invalid response from DEI rewrite service");
      }

      return result.data;
    } catch (err) {
      logger.error({ err: err.message }, "Error in DEI rewrite service");
      throw err;
    }
  }
}

module.exports = new DeiService();
