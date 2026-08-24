const { createEvidenceRef } = require("./evidence");

/**
 * Calculates pre-application Resume Health Score (0..100) and actionable quality suggestions
 */
function scoreResumeHealth(resumeProfile) {
  if (!resumeProfile) {
    return {
      score: 50,
      summary: "Resume profile not available",
      checks: [],
      suggestions: [],
    };
  }

  const checks = [];
  const suggestions = [];
  let score = 0;

  // 1. Contact Information & Online Presence (20 pts)
  let contactScore = 0;
  if (resumeProfile.contact?.email) contactScore += 8;
  if (resumeProfile.contact?.phone) contactScore += 4;
  if (resumeProfile.contact?.location) contactScore += 3;
  if (Array.isArray(resumeProfile.contact?.links) && resumeProfile.contact.links.length > 0) contactScore += 5;

  checks.push({
    name: "Contact & Links",
    score: contactScore,
    maxScore: 20,
    passed: contactScore >= 15,
    detail: `Email: ${resumeProfile.contact?.email ? "Present" : "Missing"}, Links: ${resumeProfile.contact?.links?.length || 0}`,
  });
  score += contactScore;

  if (!resumeProfile.contact?.links || resumeProfile.contact.links.length === 0) {
    suggestions.push({
      id: "health-sug-links",
      priority: "medium",
      category: "contact",
      title: "Add Online Presence Links",
      message: "Profiles with a verified GitHub, LinkedIn, or Portfolio link receive 40% more interviewer engagement.",
      action: "Add your LinkedIn or GitHub profile link to your resume header.",
      safeToApply: true,
      dedupeKey: "health-links",
      evidence: [],
    });
  }

  // 2. Work Experience & Date Clarity (30 pts)
  const experiences = Array.isArray(resumeProfile.experience) ? resumeProfile.experience : [];
  let expScore = 0;
  if (experiences.length > 0) {
    expScore += 15;
    const hasBullets = experiences.some((e) => Array.isArray(e.bullets) && e.bullets.length > 0);
    if (hasBullets) expScore += 10;
    const hasDates = experiences.some((e) => e.startDate);
    if (hasDates) expScore += 5;
  }

  checks.push({
    name: "Experience & Roles",
    score: expScore,
    maxScore: 30,
    passed: expScore >= 20,
    detail: `${experiences.length} roles documented with bullet details`,
  });
  score += expScore;

  // 3. Quantifiable Impact & Metrics (25 pts)
  const allBullets = [
    ...experiences.flatMap((e) => e.bullets || []),
    ...(Array.isArray(resumeProfile.projects) ? resumeProfile.projects.flatMap((p) => p.bullets || []) : []),
  ];
  const metricRegex = /\b(?:\d+[\d,.]*|\d+k|\d+m|\d+x|\d+%\b|\$\d+)/i;
  const quantifiedBullets = allBullets.filter((b) => metricRegex.test(b));
  const impactScore = Math.min(quantifiedBullets.length * 6, 25);

  checks.push({
    name: "Quantified Impact",
    score: impactScore,
    maxScore: 25,
    passed: impactScore >= 15,
    detail: `${quantifiedBullets.length} bullet points feature measurable metrics/results`,
  });
  score += impactScore;

  if (quantifiedBullets.length < 3) {
    suggestions.push({
      id: "health-sug-metrics",
      priority: "high",
      category: "impact",
      title: "Quantify Bullet Accomplishments",
      message: "Recruiters look for concrete outcomes (e.g. 'reduced latency by 45%', 'handled 10k RPS').",
      action: "Add measurable numbers, percentages, or scale to your top project and work bullets if accurate.",
      safeToApply: true,
      dedupeKey: "health-metrics",
      evidence: [],
    });
  }

  // 4. Skills Taxonomy Coverage (15 pts)
  const skills = Array.isArray(resumeProfile.skills) ? resumeProfile.skills : [];
  const skillScore = Math.min(skills.length * 1.5, 15);

  checks.push({
    name: "Skills Inventory",
    score: Math.round(skillScore),
    maxScore: 15,
    passed: skillScore >= 10,
    detail: `${skills.length} technical and domain skills categorized`,
  });
  score += skillScore;

  // 5. Structure & Section Completeness (10 pts)
  const sections = Array.isArray(resumeProfile.sectionsDetected) ? resumeProfile.sectionsDetected : [];
  const structureScore = Math.min(sections.length * 2, 10);

  checks.push({
    name: "Document Sections",
    score: structureScore,
    maxScore: 10,
    passed: structureScore >= 6,
    detail: `Identified sections: ${sections.join(", ")}`,
  });
  score += structureScore;

  return {
    score: Math.min(Math.round(score), 100),
    summary: score >= 80 ? "Strong Resume Quality" : (score >= 60 ? "Good Baseline — Actionable Improvements Available" : "Needs Additional Detail"),
    checks,
    suggestions,
  };
}

module.exports = {
  scoreResumeHealth,
};
