const { resumeExtractionSchema, jobGenerationSchema } = require("../../src/modules/ai/schemas");

describe("Synthetic Dataset Schema Validator Unit Tests", () => {
  it("should validate synthetic resume extraction output matching ResumeProfileSchema", () => {
    const syntheticResume = {
      skills: ["React", "Node.js", "TypeScript", "PostgreSQL", "Docker"],
      experience: [
        {
          title: "Senior Full Stack Engineer",
          company: "CloudScale Systems",
          duration: "2021 - Present",
        },
        {
          title: "Software Engineer",
          company: "DataFlow Inc",
          duration: "2019 - 2021",
        },
      ],
      education: {
        degree: "B.Tech in Computer Science",
        college: "IIT Madras",
        cgpa: 8.9,
        tier: "tier1",
      },
      achievements: [
        "Smart India Hackathon Finalist 2019",
        "Published research paper on Distributed Systems",
      ],
      summary: "Full stack engineer with 5+ years of experience in distributed systems and cloud architecture.",
    };

    const parsed = resumeExtractionSchema.safeParse(syntheticResume);
    expect(parsed.success).toBe(true);
    expect(parsed.data.education.tier).toBe("tier1");
    expect(parsed.data.education.cgpa).toBe(8.9);
    expect(parsed.data.skills.length).toBe(5);
  });

  it("should validate synthetic job generation output matching JobDraftSchema", () => {
    const syntheticJob = {
      title: "Senior Backend Engineer",
      company: "Distributed Tech Labs",
      location: "Bengaluru (Hybrid)",
      type: "Full-time",
      description: "We are seeking a senior engineer to architect our next-generation streaming platform using Go and Kafka.",
      skills: ["Go", "Kafka", "Kubernetes", "gRPC", "PostgreSQL"],
      atsRequirements: {
        minCgpa: 7.5,
        targetCollegeTier: "tier1",
        minExperienceYears: 4,
        requiredDegree: "B.Tech",
      },
    };

    const parsed = jobGenerationSchema.safeParse(syntheticJob);
    expect(parsed.success).toBe(true);
    expect(parsed.data.title).toBe("Senior Backend Engineer");
    expect(parsed.data.atsRequirements.targetCollegeTier).toBe("tier1");
  });

  it("should enforce valid tier and type enums while providing safe defaults", () => {
    const partialResume = {
      skills: ["Python", "PyTorch"],
      education: {
        degree: "B.S.",
        college: "State College",
        cgpa: null,
        tier: "tier3",
      },
      summary: "Junior ML engineer.",
    };

    const parsed = resumeExtractionSchema.safeParse(partialResume);
    expect(parsed.success).toBe(true);
    expect(parsed.data.experience).toEqual([]);
    expect(parsed.data.achievements).toEqual([]);
  });
});
