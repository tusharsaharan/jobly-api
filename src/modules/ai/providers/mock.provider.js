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

    // Check if this is a candidate questions request
    if (text.toLowerCase().includes("questions") || text.toLowerCase().includes("faq")) {
      return JSON.stringify({
        questions: [
          {
            id: "q-1",
            question: "What is the day-to-day team structure and reporting line?",
            defaultAnswer: "You will collaborate with 4 senior engineers, a product manager, and an engineering lead.",
            category: "team_structure",
          },
          {
            id: "q-2",
            question: "What are the core technologies and development workflows used daily?",
            defaultAnswer: "Our stack runs React, TypeScript, and Node.js with automated CI/CD and pull request reviews.",
            category: "tech_stack",
          },
          {
            id: "q-3",
            question: "What does the growth path and career progression look like for this position?",
            defaultAnswer: "We offer structured bi-annual performance cycles with clear milestones for staff-level progression.",
            category: "growth_path",
          },
          {
            id: "q-4",
            question: "What are the remote work expectations and core collaboration hours?",
            defaultAnswer: "We operate fully remote with 4 overlapping collaboration hours per day.",
            category: "logistics",
          },
        ],
      });
    }

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
