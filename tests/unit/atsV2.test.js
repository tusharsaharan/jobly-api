const { scoreRoleFit, scoreResumeHealth, extractSkillsFromText, resolveSkill, normalizeText } = require("../../src/modules/ats");

describe("ATS V2 Scoring Engine & Taxonomy", () => {
  const sampleProfile = {
    schemaVersion: "resume-profile/1",
    source: {
      uploadId: "upl-123",
      fileName: "alex-rivera-resume.pdf",
      mimeType: "application/pdf",
      sha256: "a".repeat(64),
      extractedAt: new Date().toISOString(),
      extractor: "gemini",
      extractionConfidence: 0.95,
    },
    contact: {
      email: "alex@example.com",
      phone: "+1 555-0199",
      location: "San Francisco, CA",
      links: [{ kind: "github", url: "https://github.com/alexrivera" }],
    },
    headline: "Staff Frontend Architect & Systems Engineer",
    summary: "Senior engineer with 8+ years building distributed web apps.",
    skills: [
      {
        canonicalId: "skill_react",
        label: "React",
        aliasesObserved: ["react", "reactjs"],
        evidence: [{ section: "skills", quote: "React, TypeScript, Node.js" }],
      },
      {
        canonicalId: "skill_typescript",
        label: "TypeScript",
        aliasesObserved: ["typescript", "ts"],
        evidence: [{ section: "skills", quote: "TypeScript" }],
      },
      {
        canonicalId: "skill_nodejs",
        label: "Node.js",
        aliasesObserved: ["nodejs", "node.js"],
        evidence: [{ section: "skills", quote: "Node.js" }],
      },
      {
        canonicalId: "skill_docker",
        label: "Docker",
        aliasesObserved: ["docker"],
        evidence: [{ section: "skills", quote: "Docker containerization" }],
      },
    ],
    experience: [
      {
        title: "Staff Frontend Architect",
        organization: "TechCorp Systems",
        startDate: "2021-01",
        endDate: null,
        isCurrent: true,
        bullets: [
          "Architected real-time collaboration canvas with WebSockets, reducing document latency by 45% for 50k DAU.",
          "Led migration of 200+ micro-frontends to React 19 and TypeScript with 99.9% uptime.",
        ],
        skills: ["React", "TypeScript", "WebSockets"],
      },
      {
        title: "Senior Full Stack Engineer",
        organization: "CloudFlow Inc",
        startDate: "2018-03",
        endDate: "2020-12",
        isCurrent: false,
        bullets: [
          "Built high-throughput ingestion pipelines in Node.js processing 10m events daily.",
          "Containerized service fleet with Docker and automated CI/CD with GitHub Actions.",
        ],
        skills: ["Node.js", "Docker", "CI/CD"],
      },
    ],
    projects: [
      {
        name: "Collaborative IDE Sandbox",
        description: "Built browser-based IDE with Dockerized code runner.",
        bullets: ["Scaled sandbox to 500 concurrent sessions."],
      },
    ],
    education: [
      {
        qualification: "Bachelor of Science in Computer Science",
        institution: "University of California, Berkeley",
        startDate: "2014",
        endDate: "2018",
      },
    ],
    certifications: [],
    achievements: [
      {
        text: "Awarded top engineering innovator 2023 for real-time sync architecture.",
        quantifiedOutcome: "Top 1% engineer",
      },
    ],
    sectionsDetected: ["contact", "summary", "skills", "experience", "projects", "education"],
    parseWarnings: [],
  };

  const sampleJob = {
    schemaVersion: "job-ats-profile/1",
    targetTitles: ["Staff Frontend Architect", "Senior Full Stack Engineer"],
    mustHaveSkills: [
      { canonicalId: "skill_react", label: "React", required: true, weight: 5 },
      { canonicalId: "skill_typescript", label: "TypeScript", required: true, weight: 5 },
      { canonicalId: "skill_nodejs", label: "Node.js", required: true, weight: 4 },
    ],
    preferredSkills: [
      { canonicalId: "skill_docker", label: "Docker", required: false, weight: 3 },
      { canonicalId: "skill_kubernetes", label: "Kubernetes", required: false, weight: 2 },
    ],
    responsibilityPhrases: [
      "real-time collaboration",
      "ingestion pipelines",
    ],
    minimumExperienceYears: 5,
    requiredEducation: {
      degrees: ["Computer Science", "Software Engineering"],
      fieldsOfStudy: [],
      required: true,
    },
    certifications: [],
    keywords: [],
  };

  test("calculates deterministic score within 0..100 and categories summing to 100", () => {
    const analysis = scoreRoleFit({
      resumeProfile: sampleProfile,
      jobAtsProfile: sampleJob,
      jobId: "job-1",
      applicationId: "app-1",
    });

    expect(analysis.overallScore).toBeGreaterThanOrEqual(0);
    expect(analysis.overallScore).toBeLessThanOrEqual(100);
    expect(analysis.categories.length).toBe(7);

    const totalMax = analysis.categories.reduce((sum, c) => sum + c.maxPoints, 0);
    expect(totalMax).toBe(100);

    expect(analysis.status).toBe("completed");
    expect(analysis.engine.version).toBe("ats-analysis/2026-08-v1");
  });

  test("runs determinism test: 100 consecutive runs produce exact identical scores", () => {
    const first = scoreRoleFit({ resumeProfile: sampleProfile, jobAtsProfile: sampleJob });
    for (let i = 0; i < 100; i++) {
      const run = scoreRoleFit({ resumeProfile: sampleProfile, jobAtsProfile: sampleJob });
      expect(run.overallScore).toBe(first.overallScore);
      expect(run.categories.map(c => c.score)).toEqual(first.categories.map(c => c.score));
    }
  });

  test("redistributes 30 points proportionally when job has no must-have skills", () => {
    const jobNoMustHave = {
      ...sampleJob,
      mustHaveSkills: [],
    };

    const analysis = scoreRoleFit({ resumeProfile: sampleProfile, jobAtsProfile: jobNoMustHave });
    const reqCat = analysis.categories.find(c => c.name === "required_skills");
    const prefCat = analysis.categories.find(c => c.name === "preferred_skills");
    const respCat = analysis.categories.find(c => c.name === "responsibilities");

    expect(reqCat.redistributed).toBe(true);
    expect(reqCat.maxPoints).toBe(0);
    expect(prefCat.maxPoints).toBe(30);
    expect(respCat.maxPoints).toBe(30);

    const totalMax = analysis.categories.reduce((sum, c) => sum + c.maxPoints, 0);
    expect(totalMax).toBe(100);
  });

  test("taxonomy isolates Java from JavaScript and C from C++", () => {
    const text1 = "Developed backend microservices in Java with Spring Boot.";
    const skills1 = extractSkillsFromText(text1);
    const hasJava = skills1.some(s => s.canonicalId === "skill_java");
    const hasJS = skills1.some(s => s.canonicalId === "skill_javascript");
    expect(hasJava).toBe(true);
    expect(hasJS).toBe(false);

    const text2 = "Proficient in C and embedded systems.";
    const skills2 = extractSkillsFromText(text2);
    const hasCPP = skills2.some(s => s.canonicalId === "skill_cpp");
    expect(hasCPP).toBe(false);
  });

  test("evaluates pre-application resume health score and generates suggestions", () => {
    const health = scoreResumeHealth(sampleProfile);
    expect(health.score).toBeGreaterThanOrEqual(70);
    expect(health.checks.length).toBe(5);
    expect(Array.isArray(health.suggestions)).toBe(true);
  });
});
