const aiService = require("../modules/ai/aiService");
const { z } = require("zod");
const logger = require("../config/logger");

const biasSchema = z.object({
  score: z.number().min(0).max(100),
  feedback: z.array(z.string())
});

class HealthScoreService {
  /**
   * Completeness score (0-100) based on how many recommended fields are filled out.
   */
  getCompletenessScore(payload) {
    let score = 0;
    const weights = {
      title: 15,
      description: 25,
      skills: 20,
      company: 10,
      location: 10,
      type: 10,
      atsRequirements: 10
    };

    if (payload.title?.length > 2) score += weights.title;
    if (payload.description?.length > 50) score += weights.description;
    if (payload.skills?.length >= 3) score += weights.skills;
    if (payload.company?.length > 2) score += weights.company;
    if (payload.location?.length > 2) score += weights.location;
    if (payload.type) score += weights.type;
    
    // Partially credit ATS requirements if at least one is set
    if (
      payload.atsRequirements?.minCgpa > 0 ||
      payload.atsRequirements?.minExperienceYears > 0 ||
      payload.atsRequirements?.targetCollegeTier !== "any" ||
      payload.atsRequirements?.requiredDegree?.length > 2
    ) {
      score += weights.atsRequirements;
    }

    return score;
  }

  /**
   * Salary Transparency score (0-100).
   */
  getSalaryTransparencyScore(payload) {
    if (!payload.salaryRange || !payload.salaryRange.visible) {
      return { score: 0, feedback: ["Salary is hidden. Visible salaries get 30% more applications."] };
    }
    
    if (!payload.salaryRange.min || !payload.salaryRange.max) {
      return { score: 50, feedback: ["Specify both a minimum and maximum salary."] };
    }

    if (payload.salaryRange.max > payload.salaryRange.min * 2) {
      return { score: 70, feedback: ["Salary range is very wide, which can deter candidates looking for clarity."] };
    }

    return { score: 100, feedback: [] };
  }

  /**
   * Bias-free language check via LLM (0-100).
   * CAUTION: Only trigger on blur.
   */
  async getBiasScore(payload) {
    if (!payload.description || payload.description.length < 50) {
      return { score: 100, feedback: [] };
    }

    try {
      const prompt = `
Analyze this job description for biased, exclusionary, or gender-coded language.
Give a score from 0 to 100 where 100 means perfectly neutral and inclusive, and 0 means highly biased.
Also provide a short array of feedback strings if there are issues (e.g. "Avoid 'rockstar' or 'ninja'", "Use 'culture add' instead of 'culture fit'").

Job Title: ${payload.title || "N/A"}
Description:
${String(payload.description).slice(0, 3000)}

Return strictly as JSON matching { "score": number, "feedback": string[] }
`;
      const result = await aiService.executeWithCascade(prompt, biasSchema, { preferredProvider: "gemini" });
      return result.data || { score: 100, feedback: [] };
    } catch (err) {
      logger.error({ err: err.message }, "Failed to get bias score");
      return { score: 100, feedback: [] }; // Fail open
    }
  }

  /**
   * Aggregate the overall Day 1 health score.
   * Derived from original 5-factor plan: Completeness (20), Bias-free (20), Salary transparency (15)
   * Sum of Day 1 weights = 55. Normalized = (Completeness*20 + Bias*20 + Salary*15) / 55
   * => ~36.4% Completeness, ~36.4% Bias-free, ~27.3% Salary transparency
   */
  async calculateHealthScore(payload, biasScore = 100) {
    const completeness = this.getCompletenessScore(payload);
    const salary = this.getSalaryTransparencyScore(payload);
    
    const total = Math.round((completeness * 20 + biasScore * 20 + salary.score * 15) / 55);
    
    return {
      total,
      breakdown: {
        completeness,
        bias: { score: biasScore, feedback: [] },
        salary
      }
    };
  }
}

module.exports = new HealthScoreService();
