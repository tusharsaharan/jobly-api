const { z } = require("zod");

/**
 * Shared coercion helpers — LLMs emit loose formats; we accept them all.
 * Every coercion degrades to a safe null/default instead of failing the
 * whole schema (which would fail the cascade over to fabricated fallbacks).
 */

// "8.5" | 8.5 | "85%" | "8.5/10" | "3.8/4" | "" | null -> number|null
function coerceCgpa(value) {
  if (value === null || value === undefined || value === "") return null;
  const str = String(value).trim();

  // Percentage form: "85%", "85 percent"
  const pct = str.match(/^(\d{1,3}(?:\.\d+)?)\s*%$/i) || str.match(/^(\d{1,3}(?:\.\d+)?)\s*percent/i);
  if (pct) {
    const p = Number(pct[1]);
    if (Number.isFinite(p)) return Math.min(10, Math.round((p / 9.5) * 100) / 100);
    return null;
  }

  // Scale-annotated form: "8.5/10", "3.8/4.0", "8.5 out of 10"
  const scale = str.match(/^(\d{1,2}(?:\.\d+)?)\s*(?:\/|out of)\s*(4|10)(?:\.0+)?$/i);
  if (scale) {
    const v = Number(scale[1]);
    const s = Number(scale[2]);
    if (Number.isFinite(v) && (s === 4 || s === 10)) {
      return Math.min(10, Math.max(0, s === 4 ? v * 2.5 : v));
    }
    return null;
  }

  // Bare number: infer scale (<=4.3 => 4-point scale, >10 impossible => null)
  const n = Number(str);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  if (n > 10) {
    // Likely a percentage written without the sign
    return Math.min(10, Math.round((n / 9.5) * 100) / 100);
  }
  return Math.min(10, n <= 4.3 ? Math.round(n * 250) / 100 : n);
}

function coerceYears(value) {
  if (value === null || value === undefined || value === "") return 0;
  const m = String(value).trim().match(/^(\d{1,2}(?:\.\d+)?)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.min(60, Math.max(0, n)) : 0;
}

function coerceTier(value) {
  if (value === null || value === undefined) return "any";
  const v = String(value).trim().toLowerCase().replace(/[\s_-]/g, "");
  if (!v || ["any", "all", "none", "norestriction", "unknown"].includes(v)) return "any";
  if (v.startsWith("tier1")) return "tier1";
  if (v.startsWith("tier2")) return "tier2";
  if (v.startsWith("tier3")) return "tier3";
  return "any";
}

function coerceJobType(value) {
  if (value === null || value === undefined) return "";
  const v = String(value).trim().toLowerCase().replace(/[\s_-]/g, "");
  if (["fulltime", "fulltimeemployee", "fte", "permanent"].includes(v)) return "Full-time";
  if (["parttime", "parttimeemployee"].includes(v)) return "Part-time";
  if (["contract", "contractor", "freelance"].includes(v)) return "Contract";
  if (["intern", "internship", "trainee"].includes(v)) return "Internship";
  return "";
}

function coerceSkillList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((s) => String(s ?? "").trim()).filter(Boolean);
  }
  // Comma/semicolon-separated string (common LLM emission)
  const parts = String(value).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return parts;
}

function coerceNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------- Schemas ----------

const resumeExtractionSchema = z.object({
  skills: z.preprocess(coerceSkillList, z.array(z.string()).default([])),
  experience: z.array(
    z.object({
      title: z.preprocess((v) => (v === null || v === undefined ? "" : String(v)), z.string().default("")),
      company: z.preprocess((v) => (v === null || v === undefined ? "" : String(v)), z.string().default("")),
      duration: z.preprocess((v) => (v === null || v === undefined ? "" : String(v)), z.string().default("")),
    })
  ).default([]),
  education: z.preprocess((v) => (v && typeof v === "object" ? v : {}), z.object({
    degree: z.preprocess((v) => (v === null || v === undefined ? "" : String(v)), z.string().default("")),
    college: z.preprocess((v) => (v === null || v === undefined ? "" : String(v)), z.string().default("")),
    cgpa: z.preprocess(coerceCgpa, z.number().min(0).max(10).nullable().default(null)),
    tier: z.preprocess(
      (v) => {
        const t = coerceTier(v);
        return t === "any" ? "unknown" : t;
      },
      z.enum(["tier1", "tier2", "tier3", "unknown"]).default("unknown")
    ),
  }).default({ degree: "", college: "", cgpa: null, tier: "unknown" })),
  achievements: z.preprocess(
    (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]),
    z.array(z.string()).default([])
  ),
  summary: z.preprocess((v) => (v === null || v === undefined ? "" : String(v)), z.string().default("")),
});

const jobGenerationSchema = z.object({
  title: z.preprocess((v) => String(v ?? "").trim(), z.string().min(2, "Job title is required")),
  company: z.preprocess((v) => String(v ?? "").trim(), z.string().default("")),
  location: z.preprocess((v) => String(v ?? "").trim(), z.string().default("")),
  type: z.preprocess(coerceJobType, z.enum(["", "Full-time", "Part-time", "Contract", "Internship"]).default("")),
  description: z.preprocess((v) => String(v ?? "").trim(), z.string().min(10, "Description must be at least 10 characters")),
  skills: z.preprocess(coerceSkillList, z.array(z.string()).default([])),
  atsRequirements: z.preprocess((v) => (v && typeof v === "object" ? v : {}), z.object({
    minCgpa: z.preprocess(coerceCgpa, z.number().min(0).max(10).default(0)),
    targetCollegeTier: z.preprocess(coerceTier, z.enum(["tier1", "tier2", "tier3", "any"]).default("any")),
    minExperienceYears: z.preprocess(coerceYears, z.number().min(0).max(60).default(0)),
    requiredDegree: z.preprocess((v) => String(v ?? "").trim(), z.string().default("")),
  }).default({
    minCgpa: 0,
    targetCollegeTier: "any",
    minExperienceYears: 0,
    requiredDegree: "",
  })),
  salaryRange: z.preprocess((v) => (v && typeof v === "object" ? v : {}), z.object({
    min: z.preprocess(coerceNumberOrNull, z.number().nullable().default(null)),
    max: z.preprocess(coerceNumberOrNull, z.number().nullable().default(null)),
    currency: z.preprocess((v) => String(v ?? "").trim() || "USD", z.string().default("USD")),
    period: z.enum(["annual", "monthly", "hourly"]).default("annual"),
    visible: z.preprocess((v) => (v === undefined ? true : Boolean(v)), z.boolean().default(true)),
  }).default({
    min: null,
    max: null,
    currency: "USD",
    period: "annual",
    visible: true,
  })),
});

const candidateQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string().optional().default("q-1"),
      question: z.preprocess((v) => String(v ?? "").trim(), z.string().min(5)),
      defaultAnswer: z.preprocess((v) => String(v ?? ""), z.string().default("")),
      category: z.preprocess((v) => String(v ?? "tech_stack").trim() || "general", z.string().default("tech_stack")),
    })
  ).default([]),
});

const conversationSummarySchema = z.object({
  summary: z.preprocess((v) => String(v ?? ""), z.string().default("")),
  highlights: z.preprocess(
    (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]),
    z.array(z.string()).default([])
  ),
});

module.exports = {
  resumeExtractionSchema,
  jobGenerationSchema,
  candidateQuestionsSchema,
  conversationSummarySchema,
  // Exported for reuse by basicParse / mock provider so ALL paths share one logic.
  coerceCgpa,
  coerceYears,
  coerceTier,
  coerceJobType,
  coerceSkillList,
};
