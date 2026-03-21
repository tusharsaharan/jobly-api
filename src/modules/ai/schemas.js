const { z } = require("zod");

const resumeExtractionSchema = z.object({
  skills: z.array(z.string()).default([]),
  experience: z.array(
    z.object({
      title: z.string().default(""),
      company: z.string().default(""),
      duration: z.string().default(""),
    })
  ).default([]),
  education: z.object({
    degree: z.string().default(""),
    college: z.string().default(""),
    cgpa: z.number().nullable().default(null),
    tier: z.enum(["tier1", "tier2", "tier3", "unknown"]).default("unknown"),
  }).default({ degree: "", college: "", cgpa: null, tier: "unknown" }),
  achievements: z.array(z.string()).default([]),
  summary: z.string().default(""),
});

const jobGenerationSchema = z.object({
  title: z.string().min(2, "Job title is required"),
  company: z.string().default(""),
  location: z.string().default(""),
  type: z.enum(["", "Full-time", "Part-time", "Contract", "Internship"]).default(""),
  description: z.string().min(10, "Description must be at least 10 characters"),
  skills: z.array(z.string()).default([]),
  atsRequirements: z.object({
    minCgpa: z.number().min(0).max(10).default(0),
    targetCollegeTier: z.enum(["tier1", "tier2", "tier3", "any"]).default("any"),
    minExperienceYears: z.number().min(0).max(60).default(0),
    requiredDegree: z.string().default(""),
  }).default({
    minCgpa: 0,
    targetCollegeTier: "any",
    minExperienceYears: 0,
    requiredDegree: "",
  }),
});

module.exports = {
  resumeExtractionSchema,
  jobGenerationSchema,
};
