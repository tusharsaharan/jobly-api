const {
  normalizeAtsRequirements,
  normalizeJobPayload,
  normalizeSkills,
  validateJobPayload,
  mergeJobDraft,
  estimateExperienceYears,
  getAtsEligibility,
  meetsAtsRequirements,
  scoreJobMatch,
} = require("../../src/utils/jobLogic");

describe("jobLogic Unit Tests", () => {
  describe("normalizeSkills", () => {
    it("should split string by delimiters, trim and lower case them", () => {
      const skills = "JavaScript, Node.js; React | Express • MongoDB";
      const result = normalizeSkills(skills);
      expect(result).toEqual(["JavaScript", "Node.js", "React", "Express", "MongoDB"]);
    });

    it("should deduplicate skills based on normalized comparison", () => {
      const skills = ["React", "react", "Node.js", "Node.js"];
      const result = normalizeSkills(skills);
      expect(result).toEqual(["React", "Node.js"]);
    });

    it("should slice to maximum 30 skills", () => {
      const skills = Array.from({ length: 40 }, (_, i) => `Skill${i}`);
      const result = normalizeSkills(skills);
      expect(result.length).toBe(30);
    });
  });

  describe("estimateExperienceYears", () => {
    it("should return 0 for empty experience", () => {
      expect(estimateExperienceYears([])).toBe(0);
      expect(estimateExperienceYears(null)).toBe(0);
    });

    it("should parse duration containing year ranges", () => {
      const exp = [{ duration: "2020 - 2022" }];
      expect(estimateExperienceYears(exp)).toBe(2);
    });

    it("should handle current year for present/now/current", () => {
      const currentYear = new Date().getFullYear();
      const exp = [{ duration: "2022 - Present" }];
      expect(estimateExperienceYears(exp)).toBe(currentYear - 2022);
    });

    it("should parse explicit years pattern like '3+ years'", () => {
      const exp = [{ duration: "3.5 years" }];
      expect(estimateExperienceYears(exp)).toBe(3.5);
    });

    it("should parse months", () => {
      const exp = [{ duration: "6 months" }];
      expect(estimateExperienceYears(exp)).toBe(0.5);
    });

    it("should merge overlapping ranges", () => {
      const exp = [
        { duration: "2018 - 2020" },
        { duration: "2019 - 2021" }
      ];
      // Merged range is 2018 - 2021 = 3 years
      expect(estimateExperienceYears(exp)).toBe(3);
    });
  });

  describe("meetsAtsRequirements", () => {
    const job = {
      atsRequirements: {
        minCgpa: 8.0,
        targetCollegeTier: "tier2",
        minExperienceYears: 2,
        requiredDegree: "B.Tech"
      }
    };

    it("should pass if seeker meets all requirements", () => {
      const user = {
        cgpa: 8.5,
        collegeTier: "tier1",
        experience: [{ duration: "2020 - 2023" }],
        degree: "B.Tech Computer Science"
      };
      expect(meetsAtsRequirements(job, user)).toBe(true);
    });

    it("should fail if CGPA is below minimum", () => {
      const user = {
        cgpa: 7.5,
        collegeTier: "tier1",
        experience: [{ duration: "2020 - 2023" }],
        degree: "B.Tech"
      };
      expect(meetsAtsRequirements(job, user)).toBe(false);
    });

    it("should fail if college tier is below target", () => {
      const user = {
        cgpa: 8.5,
        collegeTier: "tier3",
        experience: [{ duration: "2020 - 2023" }],
        degree: "B.Tech"
      };
      expect(meetsAtsRequirements(job, user)).toBe(false);
    });

    it("should fail if experience years are below minimum", () => {
      const user = {
        cgpa: 8.5,
        collegeTier: "tier1",
        experience: [{ duration: "6 months" }],
        degree: "B.Tech"
      };
      expect(meetsAtsRequirements(job, user)).toBe(false);
    });

    it("should fail if degree doesn't match", () => {
      const user = {
        cgpa: 8.5,
        collegeTier: "tier1",
        experience: [{ duration: "2020 - 2023" }],
        degree: "B.Sc Physics"
      };
      expect(meetsAtsRequirements(job, user)).toBe(false);
    });

    it("should not require a degree when the recruiter left that rule blank", () => {
      const noDegreeJob = {
        atsRequirements: {
          minCgpa: 0,
          targetCollegeTier: "any",
          minExperienceYears: 0,
          requiredDegree: "",
        },
      };
      expect(meetsAtsRequirements(noDegreeJob, { degree: "", experience: [] })).toBe(true);
    });

    it("should treat an engineering bachelor as meeting a generic bachelor's requirement", () => {
      const genericDegreeJob = {
        atsRequirements: { requiredDegree: "Bachelor's degree" },
      };
      expect(meetsAtsRequirements(genericDegreeJob, { degree: "B.Tech Computer Science" })).toBe(true);
    });

    it("should expose actionable reasons when a candidate is not eligible", () => {
      const result = getAtsEligibility(job, {
        cgpa: 7.5,
        collegeTier: "tier3",
        experience: [],
        degree: "",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual(expect.arrayContaining([
        "Requires a CGPA of 8 or higher.",
        "Requires a TIER2 or higher college profile.",
        "Requires 2+ years of experience.",
        "Requires B.Tech.",
      ]));
    });
  });

  describe("scoreJobMatch", () => {
    it("should return 100 for perfect skill match", () => {
      const job = { skills: ["React", "Node.js"] };
      const user = { skills: ["react", "nodejs"] };
      const result = scoreJobMatch(job, user);
      expect(result.score).toBe(100);
      expect(result.matchedSkills.length).toBe(2);
    });

    it("should match skill aliases (e.g. node / nodejs)", () => {
      const job = { skills: ["nodejs"] };
      const user = { skills: ["node"] };
      const result = scoreJobMatch(job, user);
      expect(result.score).toBe(100);
    });

    it("should return partial score if only some match", () => {
      const job = { skills: ["React", "Node.js", "Docker"] };
      const user = { skills: ["React", "Nodejs"] };
      const result = scoreJobMatch(job, user);
      expect(result.score).toBe(67);
    });
  });
});
