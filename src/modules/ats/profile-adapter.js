const crypto = require("crypto");
const { resolveSkill, extractSkillsFromText } = require("./normalize");
const { createEvidenceRef } = require("./evidence");
const { normalizeSkills } = require("../../utils/jobLogic");

/**
 * Build a canonical, taxonomy-aligned ResumeProfile from either the persisted
 * structured `user.resumeProfile` (rich, produced by the resume pipeline) or
 * the legacy flattened user fields + raw resume text.
 *
 * Guarantees every skill carries a real taxonomy `canonicalId` (never the
 * buggy `skill_node_js`-style string), so `scoreRoleFit` evidence resolution
 * is deterministic and correct (Java != JavaScript, C != C++).
 */
function buildResumeProfile({ user = {}, resumeText = "" } = {}) {
  const existing = user && typeof user.resumeProfile === "object" ? user.resumeProfile : null;

  // Rich profile already exists from the resume pipeline — reuse as-is.
  if (existing && Array.isArray(existing.skills) && existing.skills.length > 0) {
    return {
      ...existing,
      source: { ...(existing.source || {}), resumeText: undefined },
      skills: existing.skills.map(normalizeSkillEntry),
      experience: Array.isArray(existing.experience) ? existing.experience : [],
      projects: Array.isArray(existing.projects) ? existing.projects : [],
      education: Array.isArray(existing.education) ? existing.education : [],
      achievements: Array.isArray(existing.achievements) ? existing.achievements : [],
      certifications: Array.isArray(existing.certifications) ? existing.certifications : [],
    };
  }

  const skills = buildSkillsFromLegacy(user, resumeText);
  const experience = buildExperienceFromLegacy(user);
  const education = buildEducationFromLegacy(user);
  const achievements = (Array.isArray(user.achievements) ? user.achievements : [])
    .map((a) => ({ text: String(a), evidence: [createEvidenceRef("achievements", String(a))] }));

  const sha256 = crypto
    .createHash("sha256")
    .update(resumeText || existing?.source?.sha256 || "")
    .digest("hex");

  return {
    schemaVersion: "resume-profile/1",
    source: {
      uploadId: existing?.source?.uploadId || "legacy-upl",
      fileName: existing?.source?.fileName || "resume.pdf",
      mimeType: existing?.source?.mimeType || "application/pdf",
      sha256,
      extractedAt: existing?.source?.extractedAt || new Date().toISOString(),
      extractor: existing?.source?.extractor || "legacy-adapter",
      extractionConfidence: existing?.source?.extractionConfidence ?? 0.85,
    },
    contact: {
      email: user.email || existing?.contact?.email || "",
      phone: existing?.contact?.phone || "",
      location: existing?.contact?.location || "",
      links: existing?.contact?.links || [],
    },
    skills,
    experience,
    projects: existing?.projects || [],
    education,
    certifications: existing?.certifications || [],
    achievements,
    sectionsDetected: inferSections(resumeText, user, existing),
    parseWarnings: existing?.parseWarnings || [],
  };
}

/**
 * Build a canonical JobAtsProfile from a job document.
 * Extracts must-have skills (taxonomy-resolved), target titles, experience
 * minimum, and required education from the job's ATS requirements.
 */
function buildJobAtsProfile(job = {}) {
  const jobSkills = Array.isArray(job.skills) ? job.skills : [];
  const mustHaveSkills = jobSkills
    .filter((s) => typeof s === "string" && s.trim())
    .map((s, i) => {
      const label = s.trim();
      const resolved = resolveSkill(label);
      return {
        canonicalId: resolved ? resolved.id : null,
        label,
        required: true,
        weight: i < 5 ? 5 : 3,
      };
    });

  const reqs = job.atsRequirements || {};
  const requiredEducation = {
    required: Boolean(reqs.requiredDegree && String(reqs.requiredDegree).trim()),
    degrees: reqs.requiredDegree ? [String(reqs.requiredDegree)] : [],
    fieldsOfStudy: [],
  };

  return {
    schemaVersion: "job-ats-profile/1",
    targetTitles: job.title ? [job.title] : [],
    mustHaveSkills,
    preferredSkills: [],
    responsibilityPhrases: [],
    minimumExperienceYears: Number(reqs.minExperienceYears) || 0,
    requiredEducation,
    certifications: [],
    keywords: [],
  };
}

function normalizeSkillEntry(skill) {
  const label = skill?.label || skill?.name || String(skill?.canonicalId || "").replace(/^skill_/, "").replace(/[_-]/g, " ");
  if (!label) return skill;
  const resolved = resolveSkill(label);
  return {
    canonicalId: resolved ? resolved.id : skill?.canonicalId || null,
    label,
    aliasesObserved: Array.isArray(skill?.aliasesObserved) ? skill.aliasesObserved : [label],
    category: skill?.category || resolved?.category || null,
    evidence: Array.isArray(skill?.evidence) && skill.evidence.length > 0
      ? skill.evidence
      : [createEvidenceRef("skills", `Skill listed: ${label}`)],
  };
}

function buildSkillsFromLegacy(user, resumeText) {
  const out = [];
  const seenIds = new Set();

  const push = (canonicalId, label, quote) => {
    const key = canonicalId || `raw:${label.toLowerCase()}`;
    if (seenIds.has(key)) return;
    seenIds.add(key);
    out.push({
      canonicalId,
      label,
      aliasesObserved: [label],
      evidence: [createEvidenceRef("skills", quote || label)],
    });
  };

  for (const raw of Array.isArray(user.skills) ? user.skills : []) {
    const label = String(raw).trim();
    if (!label) continue;
    const resolved = resolveSkill(label);
    push(resolved ? resolved.id : null, label, label);
  }

  // Backfill from raw resume text so unlisted-but-present skills are matched.
  for (const s of extractSkillsFromText(resumeText || "")) {
    push(s.canonicalId, s.label, s.matchedAlias || s.label);
  }

  return out;
}

function buildExperienceFromLegacy(user) {
  return (Array.isArray(user.experience) ? user.experience : []).map((e) => {
    if (typeof e === "string") {
      return { title: e, organization: "", bullets: [], evidence: [createEvidenceRef("experience", e)] };
    }
    const title = e.title || "";
    const organization = e.company || "";
    const bullets = e.duration ? [e.duration] : [];
    return {
      title,
      organization,
      startDate: null,
      endDate: null,
      isCurrent: false,
      bullets,
      skills: [],
      evidence: [createEvidenceRef("experience", `${title} at ${organization}`)],
    };
  });
}

function buildEducationFromLegacy(user) {
  const qualification = user.degree || "";
  const institution = user.college || "";
  return [
    {
      qualification,
      fieldOfStudy: null,
      institution,
      startDate: null,
      endDate: null,
      gpa: Number.isFinite(Number(user.cgpa)) ? Number(user.cgpa) : null,
      gpaScale: 10,
      evidence: qualification
        ? [createEvidenceRef("education", `${qualification}${institution ? " — " + institution : ""}`)]
        : [],
    },
  ];
}

function inferSections(resumeText, user, existing) {
  const text = String(resumeText || "").toLowerCase();
  const sections = [];
  const markers = {
    contact: /\b(?:email|phone|linkedin|github)\b/,
    summary: /\b(?:summary|objective|profile)\b/,
    skills: /\b(?:skills|technologies|tech stack)\b/,
    experience: /\b(?:experience|employment|work history)\b/,
    projects: /\b(?:projects?)\b/,
    education: /\b(?:education|qualification)\b/,
  };
  for (const [name, re] of Object.entries(markers)) {
    if (re.test(text)) sections.push(name);
  }
  // Always reflect explicit signals from the profile.
  if (Array.isArray(existing?.sectionsDetected)) {
    for (const s of existing.sectionsDetected) if (!sections.includes(s)) sections.push(s);
  }
  if ((user.skills || []).length > 0 && !sections.includes("skills")) sections.push("skills");
  if ((user.experience || []).length > 0 && !sections.includes("experience")) sections.push("experience");
  if (user.degree && !sections.includes("education")) sections.push("education");
  return sections;
}

/**
 * Derive the legacy 6-key breakdown shape (skillMatch, experienceRelevance,
 * educationFit, projectsAndAchievements, keywordOptimization, overallPresentation)
 * from the richer category result, for backwards compatibility.
 */
function deriveLegacyBreakdown(categories) {
  const byName = (n) => (categories || []).find((c) => c.name === n);
  const c = {
    required_skills: byName("required_skills"),
    preferred_skills: byName("preferred_skills"),
    relevant_experience: byName("relevant_experience"),
    responsibilities: byName("responsibilities"),
    impact_and_outcomes: byName("impact_and_outcomes"),
    education_and_certifications: byName("education_and_certifications"),
    ats_readability: byName("ats_readability"),
  };
  const pct = (x) => (x && typeof x.percentage === "number" ? Math.round(x.percentage) : 0);
  const ratio = (a, b) => {
    const score = (a?.score || 0) + (b?.score || 0);
    const max = (a?.maxPoints || 0) + (b?.maxPoints || 0);
    return max > 0 ? Math.round((score / max) * 100) : 0;
  };

  return {
    skillMatch: ratio(c.required_skills, c.preferred_skills),
    experienceRelevance: pct(c.relevant_experience),
    educationFit: pct(c.education_and_certifications),
    projectsAndAchievements: pct(c.impact_and_outcomes),
    keywordOptimization: pct(c.responsibilities),
    overallPresentation: pct(c.ats_readability),
  };
}

/**
 * Compact the full category objects down to the fields the frontend needs.
 */
function compactCategories(categories) {
  return (categories || []).map((c) => ({
    name: c.name,
    label: c.label,
    score: c.score,
    maxPoints: c.maxPoints,
    percentage: c.percentage,
    matched: c.matchedCount,
    total: c.totalCount,
  }));
}

module.exports = {
  buildResumeProfile,
  buildJobAtsProfile,
  deriveLegacyBreakdown,
  compactCategories,
};