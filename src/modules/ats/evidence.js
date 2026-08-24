const crypto = require("crypto");

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
 * Find supporting evidence in a candidate's ResumeProfile for a target phrase or canonical skill
 */
function findEvidenceInProfile(profile, canonicalSkillId, targetPhrase = null) {
  if (!profile) return [];
  const evidences = [];

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
          if (containsMention(bullet, targetPhrase || canonicalSkillId)) {
            evidences.push(createEvidenceRef("experience", bullet));
          }
        }
      }
    }
  }

  // 3. Check projects
  if (Array.isArray(profile.projects)) {
    for (const proj of profile.projects) {
      if (proj.description && containsMention(proj.description, targetPhrase || canonicalSkillId)) {
        evidences.push(createEvidenceRef("projects", proj.description));
      }
      if (Array.isArray(proj.bullets)) {
        for (const bullet of proj.bullets) {
          if (containsMention(bullet, targetPhrase || canonicalSkillId)) {
            evidences.push(createEvidenceRef("projects", bullet));
          }
        }
      }
    }
  }

  // 4. Check achievements
  if (Array.isArray(profile.achievements)) {
    for (const ach of profile.achievements) {
      if (ach.text && containsMention(ach.text, targetPhrase || canonicalSkillId)) {
        evidences.push(createEvidenceRef("achievements", ach.text));
      }
    }
  }

  return evidences;
}

function containsMention(text, query) {
  if (!text || !query) return false;
  const cleanQuery = query.replace(/^skill_/, "").replace(/[_-]/g, " ");
  return text.toLowerCase().includes(cleanQuery.toLowerCase());
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
