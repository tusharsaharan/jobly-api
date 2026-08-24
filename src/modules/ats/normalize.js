const skillsTaxonomy = require("./taxonomy/skills.v1.json");

/**
 * Build index of alias -> canonical skill ID
 */
const aliasToSkillMap = new Map();
const skillByIdMap = new Map();

for (const skill of skillsTaxonomy.skills) {
  skillByIdMap.set(skill.id, skill);
  for (const alias of skill.aliases) {
    aliasToSkillMap.set(alias.toLowerCase().trim(), skill);
  }
}

/**
 * Normalize raw string into clean comparable text
 */
function normalizeText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s\+\#\.\-\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a skill mention to a canonical skill object from the taxonomy.
 * Uses exact matching and explicit alias mapping; never uses ambiguous substring matching.
 */
function resolveSkill(rawSkill) {
  if (!rawSkill || typeof rawSkill !== "string") return null;
  const normalized = rawSkill.toLowerCase().trim();
  
  if (aliasToSkillMap.has(normalized)) {
    return aliasToSkillMap.get(normalized);
  }
  
  // Try clean punctuation
  const cleaned = normalized.replace(/^[\W_]+|[\W_]+$/g, "");
  if (aliasToSkillMap.has(cleaned)) {
    return aliasToSkillMap.get(cleaned);
  }

  return null;
}

/**
 * Find all canonical taxonomy skills mentioned in a block of text using word-boundary matching.
 * Ensures Java != JavaScript, C != C++, etc.
 */
function extractSkillsFromText(text) {
  if (!text || typeof text !== "string") return [];
  const foundSkills = new Map();
  const lowerText = text.toLowerCase();

  for (const skill of skillsTaxonomy.skills) {
    for (const alias of skill.aliases) {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Use regex with word boundaries for alphanumeric aliases, or whitespace/punctuation boundaries for symbols (+, #)
      let regex;
      if (alias.includes("+") || alias.includes("#") || alias.includes(".")) {
        regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escapedAlias}(?:$|[^a-zA-Z0-9])`, "i");
      } else {
        regex = new RegExp(`\\b${escapedAlias}\\b`, "i");
      }

      if (regex.test(lowerText)) {
        if (!foundSkills.has(skill.id)) {
          foundSkills.set(skill.id, {
            canonicalId: skill.id,
            label: skill.label,
            category: skill.category,
            matchedAlias: alias,
          });
        }
      }
    }
  }

  return Array.from(foundSkills.values());
}

module.exports = {
  skillsTaxonomy,
  skillByIdMap,
  aliasToSkillMap,
  normalizeText,
  resolveSkill,
  extractSkillsFromText,
};
