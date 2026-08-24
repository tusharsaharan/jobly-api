/**
 * Builds actionable, truthful suggestions for candidate ATS feedback
 * Strictly enforces "add evidence if accurate", never claims unverified facts.
 */
function buildRoleFitSuggestions(categories, gaps, matchedRequirements) {
  const suggestions = [];

  // 1. Suggestions from critical gaps (Must-Have Skills)
  const criticalGaps = (gaps || []).filter((g) => g.importance === "critical");
  for (const gap of criticalGaps.slice(0, 3)) {
    suggestions.push({
      id: `sug-crit-${gap.id}`,
      priority: "high",
      category: gap.category,
      title: `Add Verified Evidence for ${gap.label}`,
      message: `The role specifies '${gap.label}' as a core requirement, but no concrete evidence was verified in your experience or project bullets.`,
      action: `If you have worked with ${gap.label}, mention the specific project, tools, and outcomes in your experience bullets.`,
      evidence: [],
      safeToApply: true,
      dedupeKey: `gap-${gap.requirementKey}`,
    });
  }

  // 2. Suggestions for Impact and Metrics
  const impactCat = categories.find((c) => c.name === "impact_and_outcomes");
  if (impactCat && impactCat.score < 7) {
    suggestions.push({
      id: "sug-impact-metrics",
      priority: "medium",
      category: "impact_and_outcomes",
      title: "Enhance Project Bullets with Metrics",
      message: "Recruiters and hiring managers look for quantifiable scale, performance improvements, or business outcomes.",
      action: "Incorporate metrics (e.g. latency reduction %, user scale, test coverage %) into your top achievements if accurate.",
      evidence: [],
      safeToApply: true,
      dedupeKey: "impact-metrics-enhancement",
    });
  }

  // 3. Suggestions for Recommended Technologies
  const recommendedGaps = (gaps || []).filter((g) => g.importance === "recommended");
  for (const gap of recommendedGaps.slice(0, 2)) {
    suggestions.push({
      id: `sug-rec-${gap.id}`,
      priority: "low",
      category: gap.category,
      title: `Highlight Experience with ${gap.label}`,
      message: `Preferred technology '${gap.label}' could strengthen your application alignment.`,
      action: `Add '${gap.label}' to your technical skills or project descriptions if you have relevant experience.`,
      evidence: [],
      safeToApply: true,
      dedupeKey: `gap-${gap.requirementKey}`,
    });
  }

  return suggestions;
}

module.exports = {
  buildRoleFitSuggestions,
};
