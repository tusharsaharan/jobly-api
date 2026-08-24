const { skillsTaxonomy, resolveSkill, extractSkillsFromText, normalizeText } = require("./normalize");
const { createEvidenceRef, findEvidenceInProfile, getRulesetHash } = require("./evidence");
const { scoreRoleFit } = require("./score-role-fit");
const { scoreResumeHealth } = require("./score-resume-health");
const { buildRoleFitSuggestions } = require("./suggestion-builder");

module.exports = {
  skillsTaxonomy,
  resolveSkill,
  extractSkillsFromText,
  normalizeText,
  createEvidenceRef,
  findEvidenceInProfile,
  getRulesetHash,
  scoreRoleFit,
  scoreResumeHealth,
  buildRoleFitSuggestions,
};
