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

    // Check if this is a conversation summary request
    if (text.includes("Summarize the following private message thread")) {
      return JSON.stringify({
        summary: "This thread covered introductions, logistics, and next steps for the role.",
        highlights: [
          "Parties introduced themselves",
          "Availability and scheduling discussed",
          "Next steps pending review",
        ],
      });
    }

    // Check if this is a candidate questions request
    if (text.includes("identify 4-5 high-signal questions")) {
      const titleMatch = text.match(/Title:\s*(.+)/i);
      const title = titleMatch ? titleMatch[1].trim() : "this role";
      return JSON.stringify({
        questions: [
          {
            id: "q-1",
            question: `What is the day-to-day team structure for the ${title} position?`,
            defaultAnswer: `As a ${title}, you will collaborate closely with cross-functional team members.`,
            category: "team_structure",
          },
          {
            id: "q-2",
            question: "What are the core technologies and workflows used daily?",
            defaultAnswer: "Our stack relies on modern tools with automated CI/CD and pull request reviews.",
            category: "tech_stack",
          },
          {
            id: "q-3",
            question: `What does the growth path look like for a ${title}?`,
            defaultAnswer: "We offer structured bi-annual performance cycles with clear milestones.",
            category: "growth_path",
          },
          {
            id: "q-4",
            question: "What are the remote work expectations?",
            defaultAnswer: "We operate fully remote with 4 overlapping collaboration hours per day.",
            category: "logistics",
          },
        ],
      });
    }

    // Check if this is a DEI rewrite request
    if (text.includes("Diversity, Equity, and Inclusion (DEI) talent acquisition consultant")) {
      const descMatch = text.match(/Original Job Description:\n"""\n([\s\S]*?)\n"""/i);
      const desc = descMatch ? descMatch[1].trim() : text;
      return JSON.stringify({
        rewrittenDescription: desc + "\n\nWe are an equal opportunity employer and welcome applications from all backgrounds.",
        improvements: [
          {
            originalPhrase: "various",
            replacementPhrase: "inclusive terms",
            reason: "Mock provider made this description more inclusive."
          }
        ],
        summary: "DEI rewrite applied via fallback parser."
      });
    }

    // Check if this is a resume parse request
    if (text.includes("You are an expert AI Resume Parser")) {
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
      description: text.length >= 20 ? text : `Engineering role with required qualifications for: ${text}`,
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
