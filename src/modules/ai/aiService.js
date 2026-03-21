const CircuitBreaker = require("opossum");
const logger = require("../../config/logger");
const providerFactory = require("./providers/provider.factory");
const { resumeExtractionSchema, jobGenerationSchema } = require("./schemas");
const { mergeJobDraft, normalizeJobPayload, normalizeSkills } = require("../../utils/jobLogic");

// Circuit breaker options per provider call
const breakerOptions = {
  timeout: 15000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
};

function sanitizeJsonOutput(raw) {
  let clean = String(raw || "").trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
  }
  return clean;
}

class AIService {
  constructor() {
    this.breakers = new Map();
  }

  _getBreaker(provider) {
    if (!this.breakers.has(provider.name)) {
      const breaker = new CircuitBreaker(
        (prompt, options) => provider.generateJSON(prompt, options),
        breakerOptions
      );
      breaker.on("open", () => logger.warn({ provider: provider.name }, "🚨 AI Circuit Breaker opened! Failing over to next provider."));
      breaker.on("halfOpen", () => logger.info({ provider: provider.name }, "🟡 AI Circuit Breaker half-open, probing upstream health."));
      breaker.on("close", () => logger.info({ provider: provider.name }, "✅ AI Circuit Breaker closed."));
      this.breakers.set(provider.name, breaker);
    }
    return this.breakers.get(provider.name);
  }

  /**
   * Execute prompt across failover cascade with Zod validation
   */
  async executeWithCascade(prompt, schema, options = {}) {
    const providers = await providerFactory.getProvidersCascade(options.preferredProvider);

    for (const provider of providers) {
      try {
        const breaker = this._getBreaker(provider);
        const rawResponse = await breaker.fire(prompt, options);
        const cleanJson = sanitizeJsonOutput(rawResponse);
        const parsed = JSON.parse(cleanJson);
        const validated = schema.safeParse(parsed);

        if (validated.success) {
          logger.debug({ provider: provider.name }, "AI execution and schema validation succeeded");
          return { success: true, data: validated.data, provider: provider.name };
        } else {
          logger.warn({ provider: provider.name, errors: validated.error.errors }, "AI output failed schema validation, trying next provider in cascade");
        }
      } catch (err) {
        logger.warn({ provider: provider.name, err: err.message }, "Provider invocation failed in cascade");
      }
    }

    // Ultimate fallback if all cascade elements somehow fail
    const fallbackParsed = schema.parse({});
    return { success: false, data: fallbackParsed, provider: "emergency-fallback" };
  }

  /**
   * Parse Resume text with multi-provider failover and Zod validation
   */
  async parseResume(pdfText, options = {}) {
    const prompt = `
You are an expert AI Resume Parser. Analyze the provided resume text and extract the following fields. Return strictly as a JSON object:
- "skills": Array of strings — technical/core skills found (max 15).
- "experience": Array of objects with { "title": string, "company": string, "duration": string }.
- "education": Object with { "degree": string, "college": string, "cgpa": number or null, "tier": "tier1" | "tier2" | "tier3" | "unknown" }.
- "achievements": Array of strings (max 5).
- "summary": A 2-3 sentence professional summary of the candidate.

Resume Text:
${String(pdfText || "").slice(0, 15000)}
`;

    const result = await this.executeWithCascade(prompt, resumeExtractionSchema, options);
    return result.data;
  }

  /**
   * Generate Job posting draft with multi-provider failover and Zod validation
   */
  async generateJobFromPrompt(userPrompt, draft = {}, options = {}) {
    const currentDraft = normalizeJobPayload(draft);
    const prompt = `
You are an expert recruiter assistant. Update the structured job posting from the recruiter's message. Return strictly as JSON:
- "title": Job title string.
- "company": Company name string.
- "location": Location string.
- "type": One of "", "Full-time", "Part-time", "Contract", "Internship".
- "description": Job description string.
- "skills": Array of required skills.
- "atsRequirements": Object with minCgpa (number), targetCollegeTier ("tier1"|"tier2"|"tier3"|"any"), minExperienceYears (number), requiredDegree (string).

Current draft:
${JSON.stringify(currentDraft)}

Recruiter's message:
${String(userPrompt || "").slice(0, 4000)}
`;

    const result = await this.executeWithCascade(prompt, jobGenerationSchema, options);
    return mergeJobDraft(currentDraft, result.data);
  }
}

const aiService = new AIService();
module.exports = aiService;
