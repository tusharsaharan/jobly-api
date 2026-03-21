const VALID_JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship"];
const VALID_TIERS = ["tier1", "tier2", "tier3", "any"];
const TIER_RANK = { unknown: 0, tier3: 1, tier2: 2, tier1: 3 };

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

function cleanInlineText(value, fallback = "") {
  return cleanText(value, fallback).replace(/\s+/g, " ");
}

function cleanDescription(value) {
  return cleanText(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeComparable(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9.+#]/g, "");
}

function normalizeLoose(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function comparableSkill(value) {
  const normalized = normalizeLoose(value);
  const aliases = { node: "nodejs", nodejs: "nodejs", reactjs: "react", vuejs: "vue" };
  return aliases[normalized] || normalized;
}

function skillsAreEquivalent(left, right) {
  const leftSkill = comparableSkill(left);
  const rightSkill = comparableSkill(right);
  return leftSkill === rightSkill ||
    (leftSkill.length >= 5 && rightSkill.length >= 5 &&
      (leftSkill.includes(rightSkill) || rightSkill.includes(leftSkill)));
}

function splitSkills(skills) {
  if (Array.isArray(skills)) return skills;
  if (typeof skills !== "string") return [];
  return skills.split(/[,;\n\r|\u2022]+/);
}

function normalizeSkills(skills) {
  const seen = new Set();
  return splitSkills(skills)
    .map((skill) => cleanInlineText(String(skill)))
    .filter(Boolean)
    .filter((skill) => {
      const key = normalizeComparable(skill);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

function normalizeJobType(type) {
  const value = cleanInlineText(type).toLowerCase().replace(/[\s_-]/g, "");
  if (!value) return "";
  if (["fulltime", "fulltimeemployee", "fte", "permanent"].includes(value)) return "Full-time";
  if (["parttime", "parttimeemployee"].includes(value)) return "Part-time";
  if (["contract", "contractor", "freelance"].includes(value)) return "Contract";
  if (["intern", "internship", "trainee"].includes(value)) return "Internship";
  return "";
}

function normalizeCollegeTier(tier) {
  const value = cleanInlineText(tier).toLowerCase().replace(/[\s_-]/g, "");
  if (!value || ["any", "all", "none", "norestriction"].includes(value)) return "any";
  if (value.startsWith("tier1")) return "tier1";
  if (value.startsWith("tier2")) return "tier2";
  if (value.startsWith("tier3")) return "tier3";
  return "any";
}

function isSupportedCollegeTier(tier) {
  const value = cleanInlineText(tier).toLowerCase().replace(/[\s_-]/g, "");
  return !value || ["any", "all", "none", "norestriction"].includes(value) || /^tier[123](?:orbetter)?$/.test(value);
}

function normalizeNumber(value, min = 0, max = Number.POSITIVE_INFINITY) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeAtsRequirements(input = {}) {
  const source = asRecord(input);
  return {
    minCgpa: normalizeNumber(source.minCgpa, 0, 10),
    targetCollegeTier: normalizeCollegeTier(source.targetCollegeTier),
    minExperienceYears: normalizeNumber(source.minExperienceYears, 0, 60),
    requiredDegree: cleanInlineText(source.requiredDegree).slice(0, 120),
  };
}

function normalizeJobPayload(input = {}) {
  const source = asRecord(input);
  return {
    title: cleanInlineText(source.title).slice(0, 160),
    company: cleanInlineText(source.company).slice(0, 160),
    location: cleanInlineText(source.location).slice(0, 160),
    type: normalizeJobType(source.type),
    description: cleanDescription(source.description).slice(0, 8000),
    skills: normalizeSkills(source.skills),
    atsRequirements: normalizeAtsRequirements(source.atsRequirements),
  };
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function validateOptionalNumber(value, label, max, errors) {
  if (!hasValue(value)) return;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > max) {
    errors[label] = `${label === "minCgpa" ? "Minimum CGPA" : "Minimum experience"} must be a number from 0 to ${max}.`;
  }
}

function validateJobPayload(input = {}) {
  const source = asRecord(input);
  const requirements = asRecord(source.atsRequirements);
  const errors = {};
  const title = cleanInlineText(source.title);
  const description = cleanDescription(source.description);

  if (title.length < 2) errors.title = "Title must contain at least 2 characters.";
  if (title.length > 160) errors.title = "Title cannot exceed 160 characters.";
  if (description.length < 20) errors.description = "Description must contain at least 20 characters.";
  if (description.length > 8000) errors.description = "Description cannot exceed 8,000 characters.";

  for (const field of ["company", "location"]) {
    if (cleanInlineText(source[field]).length > 160) {
      errors[field] = `${field === "company" ? "Company" : "Location"} cannot exceed 160 characters.`;
    }
  }

  if (hasValue(source.type) && !normalizeJobType(source.type)) {
    errors.type = "Choose a supported employment type or leave it blank.";
  }

  const rawSkills = splitSkills(source.skills);
  if (rawSkills.length > 30) errors.skills = "Add at most 30 skills.";
  if (rawSkills.some((skill) => cleanInlineText(String(skill)).length > 80)) {
    errors.skills = "Each skill must be 80 characters or fewer.";
  }

  validateOptionalNumber(requirements.minCgpa, "minCgpa", 10, errors);
  validateOptionalNumber(requirements.minExperienceYears, "minExperienceYears", 60, errors);
  if (hasValue(requirements.targetCollegeTier) && !isSupportedCollegeTier(requirements.targetCollegeTier)) {
    errors.targetCollegeTier = "Choose a supported college tier.";
  }
  if (cleanInlineText(requirements.requiredDegree).length > 120) {
    errors.requiredDegree = "Required degree cannot exceed 120 characters.";
  }

  return { value: normalizeJobPayload(source), errors };
}

function mergeJobDraft(draft, changes) {
  const base = normalizeJobPayload(draft);
  const update = normalizeJobPayload(changes);
  const updateSource = asRecord(changes);
  const updateRequirements = asRecord(updateSource.atsRequirements);
  const hasUpdate = (key) => Object.prototype.hasOwnProperty.call(updateSource, key);
  const hasRequirementUpdate = (key) => Object.prototype.hasOwnProperty.call(updateRequirements, key);

  return {
    title: hasUpdate("title") ? update.title : base.title,
    company: hasUpdate("company") ? update.company : base.company,
    location: hasUpdate("location") ? update.location : base.location,
    type: hasUpdate("type") ? update.type : base.type,
    description: hasUpdate("description") ? update.description : base.description,
    skills: hasUpdate("skills") ? update.skills : base.skills,
    atsRequirements: {
      minCgpa: hasRequirementUpdate("minCgpa") ? update.atsRequirements.minCgpa : base.atsRequirements.minCgpa,
      targetCollegeTier: hasRequirementUpdate("targetCollegeTier") ? update.atsRequirements.targetCollegeTier : base.atsRequirements.targetCollegeTier,
      minExperienceYears: hasRequirementUpdate("minExperienceYears") ? update.atsRequirements.minExperienceYears : base.atsRequirements.minExperienceYears,
      requiredDegree: hasRequirementUpdate("requiredDegree") ? update.atsRequirements.requiredDegree : base.atsRequirements.requiredDegree,
    },
  };
}

function estimateExperienceYears(experience) {
  if (!Array.isArray(experience) || experience.length === 0) return 0;

  const dateRanges = [];
  let explicitYears = 0;
  const currentYear = new Date().getFullYear();

  for (const entry of experience) {
    const duration = cleanText(typeof entry === "string" ? entry : entry?.duration);
    if (!duration || /\b(?:fresher|no experience|none|n\/?a)\b/i.test(duration)) continue;

    const years = duration.match(/\b(?:19|20)\d{2}\b/g)?.map(Number) || [];
    if (years.length >= 2) {
      dateRanges.push([Math.min(...years), Math.max(...years)]);
      continue;
    }
    if (years.length === 1 && /\b(?:present|current|now)\b/i.test(duration)) {
      dateRanges.push([years[0], currentYear]);
      continue;
    }

    const yearsMatch = duration.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i);
    if (yearsMatch) {
      explicitYears += Number(yearsMatch[1]);
      continue;
    }

    const monthsMatch = duration.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?)/i);
    if (monthsMatch) explicitYears += Number(monthsMatch[1]) / 12;
  }

  dateRanges.sort((a, b) => a[0] - b[0]);
  const mergedRanges = [];
  for (const range of dateRanges) {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
    } else {
      mergedRanges.push([...range]);
    }
  }

  const datedYears = mergedRanges.reduce((total, [start, end]) => total + Math.max(0, end - start), 0);
  return Math.round((datedYears + explicitYears) * 10) / 10;
}

function canonicalDegree(value) {
  const degree = normalizeLoose(value);
  if (!degree) return "";
  if (/(btech|bacheloroftechnology|bachelorofengineering|beengineering)/.test(degree)) return "btech";
  if (/(mtech|masteroftechnology|masterofengineering|meengineering)/.test(degree)) return "mtech";
  if (/(bsc|bachelorsofscience|bachelorscience)/.test(degree)) return "bsc";
  if (/(msc|masterofscience)/.test(degree)) return "msc";
  if (/mba|masterofbusinessadministration/.test(degree)) return "mba";
  if (/phd|doctorofphilosophy/.test(degree)) return "phd";
  if (/(bachelorsdegree|bachelordegree|undergraduatedegree|undergraduate)/.test(degree)) return "bachelor";
  if (/(mastersdegree|masterdegree|postgraduatedegree|postgraduate)/.test(degree)) return "master";
  return degree;
}

function degreesMatch(userDegree, requiredDegree) {
  const user = canonicalDegree(userDegree);
  const required = canonicalDegree(requiredDegree);
  if (!user || !required) return false;
  if (user === required || user.includes(required) || required.includes(user)) return true;
  if (required === "bachelor") return ["bachelor", "btech", "bsc"].includes(user);
  if (required === "master") return ["master", "mtech", "msc", "mba"].includes(user);
  return false;
}

function getAtsEligibility(job, user) {
  const reqs = normalizeAtsRequirements(job?.atsRequirements);
  const reasons = [];

  if (reqs.minCgpa > 0 && normalizeNumber(user?.cgpa, 0, 10) < reqs.minCgpa) {
    reasons.push(`Requires a CGPA of ${reqs.minCgpa} or higher.`);
  }

  if (reqs.targetCollegeTier !== "any") {
    const requiredRank = TIER_RANK[reqs.targetCollegeTier] || 0;
    const userRank = TIER_RANK[user?.collegeTier] || 0;
    if (userRank < requiredRank) {
      reasons.push(`Requires a ${reqs.targetCollegeTier.toUpperCase()} or higher college profile.`);
    }
  }

  if (reqs.minExperienceYears > 0 && estimateExperienceYears(user?.experience) < reqs.minExperienceYears) {
    reasons.push(`Requires ${reqs.minExperienceYears}+ years of experience.`);
  }
  if (reqs.requiredDegree && !degreesMatch(user?.degree, reqs.requiredDegree)) {
    reasons.push(`Requires ${reqs.requiredDegree}.`);
  }

  return { eligible: reasons.length === 0, reasons };
}

function meetsAtsRequirements(job, user) {
  return getAtsEligibility(job, user).eligible;
}

function scoreJobMatch(job, user) {
  const jobSkills = normalizeSkills(job?.skills);
  const userSkills = normalizeSkills(user?.skills);

  if (jobSkills.length === 0) return { score: 0, matchedSkills: [] };

  const matchedSkills = jobSkills.filter((jobSkill) => {
    return userSkills.some((userSkill) => skillsAreEquivalent(jobSkill, userSkill));
  });

  return {
    score: Math.round((matchedSkills.length / jobSkills.length) * 100),
    matchedSkills,
  };
}

module.exports = {
  normalizeAtsRequirements,
  normalizeJobPayload,
  normalizeSkills,
  validateJobPayload,
  mergeJobDraft,
  estimateExperienceYears,
  getAtsEligibility,
  meetsAtsRequirements,
  scoreJobMatch,
};
