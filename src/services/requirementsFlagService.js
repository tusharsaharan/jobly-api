const aiService = require("../modules/ai/aiService");
const { z } = require("zod");
const logger = require("../config/logger");

const flagSchema = z.object({
  flags: z.array(
    z.object({
      field: z.string(),
      severity: z.enum(["warning", "critical"]),
      message: z.string()
    })
  )
});

class RequirementsFlagService {
  /**
   * Run fast, rule-based checks. Safe to run on every keystroke (debounced).
   */
  getRuleBasedFlags(payload) {
    const flags = [];
    
    // TODO: Validate these thresholds against real platform data before scaling.
    // Do not show these percentages to users until N > 100 historical postings confirm them.
    
    if (payload.atsRequirements?.minExperienceYears >= 8 && payload.type === "Internship") {
      flags.push({
        severity: "critical",
        message: "8+ years experience for an internship is unrealistic.",
        field: "minExperienceYears"
      });
    }

    if (Array.isArray(payload.skills) && payload.skills.length > 12) {
      flags.push({
        severity: "warning",
        message: `${payload.skills.length} required skills — postings with 5-8 skills generally get more applications.`,
        field: "skills"
      });
    }

    if (payload.atsRequirements?.minCgpa >= 9.0) {
      flags.push({
        severity: "warning",
        message: "CGPA ≥ 9.0 filters out a vast majority of candidates.",
        field: "minCgpa"
      });
    }

    return flags;
  }

  /**
   * Run nuanced LLM-based checks. 
   * CAUTION: Should only be triggered on blur or explicit request to control API costs.
   */
  async getSemanticFlags(payload) {
    try {
      const prompt = `
You are an expert technical recruiter analyzing a job posting draft.
Identify if there are severe contradictions between stated requirements and typical market expectations.
For example, requiring 10 years of experience in a technology that has only existed for 3 years, or asking for Director-level experience for an Entry-level title.

Job Title: ${payload.title || "N/A"}
Experience Required: ${payload.atsRequirements?.minExperienceYears || 0} years
Job Type: ${payload.type || "N/A"}
Description:
${String(payload.description || "").slice(0, 3000)}

Return strictly as JSON matching this schema: { flags: [{ field: string, severity: "warning"|"critical", message: string }] }
If no severe contradictions exist, return { "flags": [] }
`;

      const result = await aiService.executeWithCascade(prompt, flagSchema, { preferredProvider: "gemini" });
      return result.data?.flags || [];
    } catch (err) {
      logger.error({ err: err.message }, "Failed to get semantic flags");
      return [];
    }
  }
}

module.exports = new RequirementsFlagService();
