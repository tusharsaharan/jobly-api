const crypto = require("crypto");
const { extractSkillsFromText, resolveSkill, aliasToSkillMap } = require("./normalize");

/**
 * Creates a clean EvidenceRef object limited to 240 characters for the quote
 */
function createEvidenceRef(section, quote, pageNumber = null, charStart = null, charEnd = null) {
  const cleanQuote = (quote || "").toString().trim().replace(/\s+/g, " ").slice(0, 240);
  return {
    section: section || "custom",
    pageNumber: pageNumber || null,
    charStart: charStart !== undefined ? charStart : null,
    charEnd: charEnd !== undefined ? charEnd : null,
    quote: cleanQuote,
  };
}

/**
 * Get all search terms (aliases) for a canonical skill ID from the taxonomy
 */
function getSearchTermsForSkill(canonicalSkillId, targetPhrase = null) {
  const terms = new Set();
  
  if (targetPhrase) {
    terms.add(targetPhrase.toLowerCase().trim());
  }
  
  if (canonicalSkillId) {
    const skill = resolveSkill(canonicalSkillId);
    if (skill && skill.aliases) {
      for (const alias of skill.aliases) {
        terms.add(alias.toLowerCase().trim());
      }
    }
    // Also add the canonical ID without prefix
    terms.add(canonicalSkillId.replace(/^skill_/, "").replace(/[_-]/g, " "));
  }
  
  return Array.from(terms).filter(Boolean);
}

/**
 * Check if text contains any of the search terms using word-boundary matching
 */
function textContainsSkill(text, searchTerms) {
  if (!text || !searchTerms || searchTerms.length === 0) return false;
  const lowerText = text.toLowerCase();
  
  for (const term of searchTerms) {
    if (term.includes("+") || term.includes("#") || term.includes(".")) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, "i");
      if (regex.test(lowerText)) return true;
    } else {
      const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(lowerText)) return true;
    }
  }
  return false;
}

/**
 * Find supporting evidence in a candidate's ResumeProfile for a target phrase or canonical skill
 * Uses taxonomy-aware alias matching with word boundaries for precision.
 */
function findEvidenceInProfile(profile, canonicalSkillId, targetPhrase = null) {
  if (!profile) return [];
  const evidences = [];
  const searchTerms = getSearchTermsForSkill(canonicalSkillId, targetPhrase);

  // 1. Check explicit skills section
  if (Array.isArray(profile.skills)) {
    for (const s of profile.skills) {
      if (s.canonicalId === canonicalSkillId || (s.label && targetPhrase && s.label.toLowerCase() === targetPhrase.toLowerCase())) {
        if (Array.isArray(s.evidence) && s.evidence.length > 0) {
          evidences.push(...s.evidence);
        } else {
          evidences.push(createEvidenceRef("skills", `Skill listed: ${s.label}`));
        }
      }
    }
  }

  // 2. Check experience bullets
  if (Array.isArray(profile.experience)) {
    for (const exp of profile.experience) {
      if (Array.isArray(exp.bullets)) {
        for (const bullet of exp.bullets) {
          if (textContainsSkill(bullet, searchTerms)) {
            evidences.push(createEvidenceRef("experience", bullet));
          }
        }
      }
    }
  }

  // 3. Check projects
  if (Array.isArray(profile.projects)) {
    for (const proj of profile.projects) {
      if (proj.description && textContainsSkill(proj.description, searchTerms)) {
        evidences.push(createEvidenceRef("projects", proj.description));
      }
      if (Array.isArray(proj.bullets)) {
        for (const bullet of proj.bullets) {
          if (textContainsSkill(bullet, searchTerms)) {
            evidences.push(createEvidenceRef("projects", bullet));
          }
        }
      }
    }
  }

  // 4. Check achievements
  if (Array.isArray(profile.achievements)) {
    for (const ach of profile.achievements) {
      if (ach.text && textContainsSkill(ach.text, searchTerms)) {
        evidences.push(createEvidenceRef("achievements", ach.text));
      }
    }
  }

  return evidences;
}

/**
 * Generate a deterministic hash of the ruleset and engine version
 */
function getRulesetHash(version = "ats-analysis/2026-08-v1") {
  return crypto.createHash("sha256").update(`jobly-ats-engine-v2:${version}`).digest("hex").slice(0, 16);
}

module.exports = {
  createEvidenceRef,
  findEvidenceInProfile,
  getRulesetHash,
};
