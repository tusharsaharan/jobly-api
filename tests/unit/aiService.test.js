const aiService = require("../../src/modules/ai/aiService");
const providerFactory = require("../../src/modules/ai/providers/provider.factory");
const { resumeExtractionSchema, jobGenerationSchema } = require("../../src/modules/ai/schemas");

describe("AI Module: Multi-Provider Abstraction & Zod Schema Validation", () => {
  describe("Provider Factory Cascade", () => {
    it("should provide an ordered failover cascade ending in rule-based mock", async () => {
      const cascade = await providerFactory.getProvidersCascade();
      expect(Array.isArray(cascade)).toBe(true);
      expect(cascade.length).toBeGreaterThanOrEqual(1);
      const lastProvider = cascade[cascade.length - 1];
      expect(lastProvider.name).toBe("RuleBasedMock");
    });

    it("should respect preference ordering when preferred provider is specified", async () => {
      const mockCascade = await providerFactory.getProvidersCascade("mock");
      expect(mockCascade[mockCascade.length - 1].name).toBe("RuleBasedMock");
    });
  });

  describe("Zod Resume Extraction Schema", () => {
    it("should validate and apply defaults on clean input", () => {
      const input = {
        skills: ["typescript", "react", "node"],
        experience: [{ title: "Software Engineer", company: "Google", duration: "2 years" }],
        education: { degree: "B.Tech", college: "IIT Delhi", cgpa: 9.2, tier: "tier1" },
        achievements: ["Hackathon Winner"],
        summary: "Full stack engineer.",
      };
      const result = resumeExtractionSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data.skills).toEqual(["typescript", "react", "node"]);
      expect(result.data.education.tier).toBe("tier1");
    });

    it("should gracefully sanitize empty or missing fields with safe defaults", () => {
      const result = resumeExtractionSchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data.skills).toEqual([]);
      expect(result.data.experience).toEqual([]);
      expect(result.data.education.tier).toBe("unknown");
      expect(result.data.summary).toBe("");
    });
  });

  describe("Zod Job Generation Schema", () => {
    it("should validate a valid job specification", () => {
      const input = {
        title: "Senior Backend Engineer",
        company: "Acme Corp",
        location: "Remote",
        type: "Full-time",
        description: "Looking for an engineer experienced in high scale distributed systems.",
        skills: ["Node.js", "Redis", "Temporal"],
        atsRequirements: {
          minCgpa: 7.5,
          targetCollegeTier: "tier1",
          minExperienceYears: 3,
          requiredDegree: "B.Tech",
        },
      };
      const result = jobGenerationSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data.title).toBe("Senior Backend Engineer");
      expect(result.data.atsRequirements.minExperienceYears).toBe(3);
    });

    it("should reject job postings without minimum description or title", () => {
      const invalid = {
        title: "A", // too short
        description: "Short", // too short
      };
      const result = jobGenerationSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("AIService Cascade Execution & Resilient Parsing", () => {
    it("should parse resume text and return structured schema matching candidate profile", async () => {
      const text = `
        Alex Mercer
        Email: alex@example.com
        Education: B.Tech in Computer Science from National Institute of Technology, CGPA: 8.8.
        Skills: JavaScript, TypeScript, React, Node.js, Express, MongoDB, Docker, AWS.
        Experience: Software Engineer at StartupX (2022 - 2024). Built scalable microservices.
      `;

      const parsed = await aiService.parseResume(text);
      expect(parsed).toBeDefined();
      expect(Array.isArray(parsed.skills)).toBe(true);
      expect(parsed.skills.some((s) => /javascript|react|node|docker|aws/i.test(s))).toBe(true);
      expect(parsed.education).toBeDefined();
    });

    it("should generate job posting from recruiter natural language prompt", async () => {
      const prompt = "We need a Full Stack Developer in San Francisco with 3+ years experience in React, Node, and Postgres.";
      const draft = {
        title: "Developer",
        company: "Tech Co",
      };

      const result = await aiService.generateJobFromPrompt(prompt, draft);
      expect(result).toBeDefined();
      expect(result.title).toBeDefined();
      expect(result.skills.length).toBeGreaterThan(0);
    });
  });
});
