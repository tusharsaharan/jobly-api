const BaseAIProvider = require("./base.provider");
const { normalizeSkills, mergeJobDraft } = require("../../../utils/jobLogic");

class MockRuleBasedProvider extends BaseAIProvider {
  constructor() {
    super("RuleBasedMock");
  }

  async isAvailable() {
    return true;
  }

  async generateJSON(prompt, options = {}) {
    const text = String(prompt || "");

    // Check if this is a resume parse request or job generation request
    if (text.toLowerCase().includes("resume") || text.toLowerCase().includes("candidate")) {
      const skillsList = [
        "javascript", "react", "node", "nodejs", "express", "mongodb", "sql",
        "python", "java", "c++", "html", "css", "git", "typescript",
        "docker", "aws", "kubernetes", "angular", "vue", "django", "flask",
      ];
      const skills = skillsList.filter((skill) => text.toLowerCase().includes(skill));
      const degree = text.match(/\b(?:b\.?tech|m\.?tech|bachelor(?:'s)?(?:\s+of\s+(?:technology|engineering|science))?|master(?:'s)?(?:\s+of\s+(?:technology|engineering|science))?|mba|ph\.?d)\b[^\n,;]*/i)?.[0] || "";
      const cgpaMatch = text.match(/\b(?:cgpa|gpa)\s*[:=-]?\s*(10(?:\.0+)?|\d(?:\.\d+)?)(?:\s*\/\s*(4|10))?/i);
      const cgpa = cgpaMatch ? Number(cgpaMatch[1]) * (cgpaMatch[2] === "4" ? 2.5 : 1) : null;

      return JSON.stringify({
        skills,
        experience: [],
        education: {
          degree,
          college: "",
          cgpa,
          tier: "unknown",
        },
        achievements: [],
        summary: "Extracted candidate details via fallback rule parser.",
      });
    }

    // Otherwise Job Generation format
    const knownSkills = [
      "React", "TypeScript", "JavaScript", "Node.js", "Express", "MongoDB", "SQL",
      "Python", "Java", "C++", "AWS", "Docker", "Kubernetes", "Angular", "Vue",
    ];
    const mentionedSkills = knownSkills.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(text));

    return JSON.stringify({
      title: "Generated Role",
      company: "",
      location: "",
      type: "Full-time",
      description: text.length >= 20 ? text : "Engineering role with required qualifications.",
      skills: normalizeSkills(mentionedSkills),
      atsRequirements: {
        minCgpa: 0,
        targetCollegeTier: "any",
        minExperienceYears: 0,
        requiredDegree: "",
      },
    });
  }
}

module.exports = MockRuleBasedProvider;
