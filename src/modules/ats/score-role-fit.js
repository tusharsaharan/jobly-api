const { resolveSkill, extractSkillsFromText } = require("./normalize");
const { createEvidenceRef, findEvidenceInProfile, getRulesetHash } = require("./evidence");
const { buildRoleFitSuggestions } = require("./suggestion-builder");

const ATS_ANALYSIS_VERSION = "ats-analysis/2026-08-v1";
const TAXONOMY_VERSION = "skills-taxonomy/2026-08-v1";

/**
 * Deterministic calculation of Job-Fit ATS Analysis
 * Returns strict AtsAnalysis object matching AtsAnalysisSchema
 */
function scoreRoleFit({ resumeProfile, jobAtsProfile, jobId = null, applicationId = null, resumeUploadId = "upload-default", resumeHash = "" }) {
  if (!resumeProfile || !jobAtsProfile) {
    throw new Error("scoreRoleFit requires both resumeProfile and jobAtsProfile");
  }

  const matchedRequirements = [];
  const gaps = [];
  const categories = [];

  // ==========================================
  // 1. Required Skills Evidence (Max 30 pts)
  // ==========================================
  const mustHaves = Array.isArray(jobAtsProfile.mustHaveSkills) ? jobAtsProfile.mustHaveSkills : [];
  let reqSkillScore = 0;
  let reqSkillMax = 30;
  let reqSkillRedistributed = false;
  let reqSkillMatchedCount = 0;
  const reqSkillEvidenceIds = [];

  if (mustHaves.length === 0) {
    // Redistribute 30 points to preferred skills (+15) and responsibilities (+15)
    reqSkillRedistributed = true;
    reqSkillMax = 0;
    reqSkillScore = 0;
  } else {
    let totalWeight = 0;
    let earnedWeight = 0;

    for (const req of mustHaves) {
      const weight = req.weight || 3;
      totalWeight += weight;

      const resolvedReq = resolveSkill(req.canonicalId || req.label);
      const targetId = resolvedReq ? resolvedReq.id : req.canonicalId;

      const profileEvidence = findEvidenceInProfile(resumeProfile, targetId, req.label);
      const isMatched = profileEvidence.length > 0;

      if (isMatched) {
        earnedWeight += weight;
        reqSkillMatchedCount++;
        const evidenceId = `req-ev-${targetId}-${matchedRequirements.length}`;
        reqSkillEvidenceIds.push(evidenceId);

        matchedRequirements.push({
          id: evidenceId,
          requirementKey: targetId || req.label,
          category: "required_skills",
          label: req.label,
          isMustHave: true,
          weight,
          matchedSource: profileEvidence[0].section || "skills",
          matchedText: profileEvidence[0].quote,
          evidenceRef: profileEvidence[0],
        });
      } else {
        gaps.push({
          id: `gap-musthave-${targetId}-${gaps.length}`,
          requirementKey: targetId || req.label,
          category: "required_skills",
          label: req.label,
          isMustHave: true,
          importance: "critical",
          explanation: `Must-have skill '${req.label}' was not verified in your resume profile or experience bullets.`,
          suggestedAction: `Add concrete projects or experience demonstrating your use of ${req.label} if accurate.`,
        });
      }
    }

    reqSkillScore = totalWeight > 0 ? (earnedWeight / totalWeight) * 30 : 30;
  }

  categories.push({
    name: "required_skills",
    label: "Required Skills Evidence",
    score: Math.round(reqSkillScore * 10) / 10,
    maxPoints: reqSkillMax,
    percentage: reqSkillMax > 0 ? Math.round((reqSkillScore / reqSkillMax) * 100) : 100,
    weight: reqSkillMax,
    explanation: reqSkillRedistributed
      ? "No must-have skills specified by recruiter; weight redistributed proportionally."
      : `Verified evidence for ${reqSkillMatchedCount} of ${mustHaves.length} required must-have skills.`,
    matchedCount: reqSkillMatchedCount,
    totalCount: mustHaves.length,
    evidenceIds: reqSkillEvidenceIds,
    redistributed: reqSkillRedistributed,
  });

  // ==========================================
  // 2. Preferred Skills & Terminology (Max 15 + redist)
  // ==========================================
  const preferredSkills = Array.isArray(jobAtsProfile.preferredSkills) ? jobAtsProfile.preferredSkills : [];
  const prefMax = reqSkillRedistributed ? 30 : 15;
  let prefScore = 0;
  let prefMatchedCount = 0;
  const prefEvidenceIds = [];

  if (preferredSkills.length > 0) {
    let prefTotalWeight = 0;
    let prefEarnedWeight = 0;

    for (const pref of preferredSkills) {
      const weight = pref.weight || 2;
      prefTotalWeight += weight;

      const resolved = resolveSkill(pref.canonicalId || pref.label);
      const targetId = resolved ? resolved.id : pref.canonicalId;
      const ev = findEvidenceInProfile(resumeProfile, targetId, pref.label);

      if (ev.length > 0) {
        prefEarnedWeight += weight;
        prefMatchedCount++;
        const evId = `pref-ev-${targetId}-${matchedRequirements.length}`;
        prefEvidenceIds.push(evId);

        matchedRequirements.push({
          id: evId,
          requirementKey: targetId || pref.label,
          category: "preferred_skills",
          label: pref.label,
          isMustHave: false,
          weight,
          matchedSource: ev[0].section || "skills",
          matchedText: ev[0].quote,
          evidenceRef: ev[0],
        });
      } else {
        gaps.push({
          id: `gap-pref-${targetId}-${gaps.length}`,
          requirementKey: targetId || pref.label,
          category: "preferred_skills",
          label: pref.label,
          isMustHave: false,
          importance: "recommended",
          explanation: `Preferred skill '${pref.label}' was not found in your profile.`,
          suggestedAction: `Mention experience with ${pref.label} if applicable to strengthen your match.`,
        });
      }
    }

    prefScore = prefTotalWeight > 0 ? (prefEarnedWeight / prefTotalWeight) * prefMax : prefMax;
  } else {
    prefScore = prefMax; // Full credit if none listed
  }

  categories.push({
    name: "preferred_skills",
    label: "Preferred Skills & Terminology",
    score: Math.round(prefScore * 10) / 10,
    maxPoints: prefMax,
    percentage: Math.round((prefScore / prefMax) * 100),
    weight: prefMax,
    explanation: preferredSkills.length > 0
      ? `Found ${prefMatchedCount} of ${preferredSkills.length} preferred technologies.`
      : "No additional preferred skills required.",
    matchedCount: prefMatchedCount,
    totalCount: preferredSkills.length,
    evidenceIds: prefEvidenceIds,
    redistributed: false,
  });

  // ==========================================
  // 3. Relevant Experience & Seniority (Max 20 pts)
  // ==========================================
  const experienceEntries = Array.isArray(resumeProfile.experience) ? resumeProfile.experience : [];
  const minYearsRequired = jobAtsProfile.minimumExperienceYears || 0;
  let expScore = 0;
  const expMax = 20;
  const expEvidenceIds = [];

  // Calculate approximate years of experience from entries
  const totalYears = experienceEntries.length * 1.5; // Baseline heuristic from dated roles
  const yearsMet = minYearsRequired > 0 ? Math.min(totalYears / minYearsRequired, 1.0) : 1.0;

  // Title matching against targetTitles
  let titleMatchBonus = 0;
  const targetTitles = Array.isArray(jobAtsProfile.targetTitles) ? jobAtsProfile.targetTitles : [];
  for (const exp of experienceEntries) {
    if (exp.title) {
      for (const t of targetTitles) {
        if (exp.title.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(exp.title.toLowerCase())) {
          titleMatchBonus = 1.0;
          const evId = `exp-title-${expEvidenceIds.length}`;
          expEvidenceIds.push(evId);
          matchedRequirements.push({
            id: evId,
            requirementKey: `title-${t}`,
            category: "relevant_experience",
            label: `Relevant Title: ${exp.title}`,
            isMustHave: false,
            weight: 3,
            matchedSource: "experience",
            matchedText: `${exp.title} at ${exp.organization}`,
            evidenceRef: createEvidenceRef("experience", `${exp.title} at ${exp.organization}`),
          });
          break;
        }
      }
    }
  }

  expScore = (yearsMet * 12) + (titleMatchBonus > 0 ? 8 : (experienceEntries.length > 0 ? 5 : 0));
  expScore = Math.min(expScore, expMax);

  categories.push({
    name: "relevant_experience",
    label: "Relevant Experience & Depth",
    score: Math.round(expScore * 10) / 10,
    maxPoints: expMax,
    percentage: Math.round((expScore / expMax) * 100),
    weight: expMax,
    explanation: minYearsRequired > 0
      ? `Demonstrated experience depth relative to ${minYearsRequired}+ years requirement.`
      : `Documented ${experienceEntries.length} professional roles with verified title relevance.`,
    matchedCount: titleMatchBonus > 0 ? 1 : 0,
    totalCount: 1,
    evidenceIds: expEvidenceIds,
    redistributed: false,
  });

  // ==========================================
  // 4. Responsibilities & Project Evidence (Max 15 + redist)
  // ==========================================
  const respPhrases = Array.isArray(jobAtsProfile.responsibilityPhrases) ? jobAtsProfile.responsibilityPhrases : [];
  const respMax = reqSkillRedistributed ? 30 : 15;
  let respScore = 0;
  let respMatchedCount = 0;
  const respEvidenceIds = [];

  const allBullets = [
    ...experienceEntries.flatMap((e) => e.bullets || []),
    ...(Array.isArray(resumeProfile.projects) ? resumeProfile.projects.flatMap((p) => [p.description || "", ...(p.bullets || [])]) : []),
  ].filter(Boolean);

  if (respPhrases.length > 0) {
    for (const phrase of respPhrases) {
      const lowerPhrase = phrase.toLowerCase();
      const match = allBullets.find((b) => b.toLowerCase().includes(lowerPhrase));
      if (match) {
        respMatchedCount++;
        const evId = `resp-ev-${respEvidenceIds.length}`;
        respEvidenceIds.push(evId);
        matchedRequirements.push({
          id: evId,
          requirementKey: `resp-${phrase.slice(0, 30)}`,
          category: "responsibilities",
          label: phrase,
          isMustHave: false,
          weight: 2,
          matchedSource: "experience",
          matchedText: match,
          evidenceRef: createEvidenceRef("experience", match),
        });
      }
    }
    respScore = (respMatchedCount / respPhrases.length) * respMax;
  } else {
    // Score based on total documented project/experience bullet evidence
    respScore = Math.min(allBullets.length * 1.5, respMax);
  }

  categories.push({
    name: "responsibilities",
    label: "Responsibilities & Projects",
    score: Math.round(respScore * 10) / 10,
    maxPoints: respMax,
    percentage: Math.round((respScore / respMax) * 100),
    weight: respMax,
    explanation: respPhrases.length > 0
      ? `Matched ${respMatchedCount} of ${respPhrases.length} core job responsibility themes.`
      : `Documented ${allBullets.length} project and accomplishment bullets.`,
    matchedCount: respMatchedCount,
    totalCount: respPhrases.length || allBullets.length,
    evidenceIds: respEvidenceIds,
    redistributed: false,
  });

  // ==========================================
  // 5. Impact and Quantified Outcomes (Max 10 pts)
  // ==========================================
  const metricRegex = /\b(?:\d+[\d,.]*|\d+k|\d+m|\d+x|\d+%\b|\$\d+)/i;
  const quantifiedBullets = allBullets.filter((b) => metricRegex.test(b));
  const impactScore = Math.min(quantifiedBullets.length * 2.5, 10);
  const impactEvidenceIds = [];

  for (let i = 0; i < Math.min(quantifiedBullets.length, 3); i++) {
    const evId = `impact-ev-${i}`;
    impactEvidenceIds.push(evId);
    matchedRequirements.push({
      id: evId,
      requirementKey: `impact-${i}`,
      category: "impact_and_outcomes",
      label: "Quantified Outcome",
      isMustHave: false,
      weight: 2,
      matchedSource: "experience",
      matchedText: quantifiedBullets[i],
      evidenceRef: createEvidenceRef("experience", quantifiedBullets[i]),
    });
  }

  categories.push({
    name: "impact_and_outcomes",
    label: "Quantified Impact & Outcomes",
    score: Math.round(impactScore * 10) / 10,
    maxPoints: 10,
    percentage: Math.round((impactScore / 10) * 100),
    weight: 10,
    explanation: `Identified ${quantifiedBullets.length} bullet points with measurable impact and metrics.`,
    matchedCount: quantifiedBullets.length,
    totalCount: allBullets.length,
    evidenceIds: impactEvidenceIds,
    redistributed: false,
  });

  // ==========================================
  // 6. Required Education & Certifications (Max 5 pts)
  // ==========================================
  const reqEdu = jobAtsProfile.requiredEducation;
  let eduScore = 5;
  const eduEvidenceIds = [];

  if (reqEdu && reqEdu.required && reqEdu.degrees && reqEdu.degrees.length > 0) {
    const candidateEdu = Array.isArray(resumeProfile.education) ? resumeProfile.education : [];
    const hasDegree = candidateEdu.some((e) =>
      reqEdu.degrees.some((d) => (e.qualification || "").toLowerCase().includes(d.toLowerCase()))
    );

    if (hasDegree) {
      eduScore = 5;
      const evId = `edu-ev-0`;
      eduEvidenceIds.push(evId);
      matchedRequirements.push({
        id: evId,
        requirementKey: "edu-required",
        category: "education_and_certifications",
        label: "Required Education",
        isMustHave: true,
        weight: 3,
        matchedSource: "education",
        matchedText: candidateEdu[0]?.qualification || "Degree verified",
        evidenceRef: createEvidenceRef("education", candidateEdu[0]?.qualification || "Degree"),
      });
    } else {
      eduScore = 0;
      gaps.push({
        id: `gap-edu-0`,
        requirementKey: "edu-required",
        category: "education_and_certifications",
        label: reqEdu.degrees.join(", "),
        isMustHave: true,
        importance: "critical",
        explanation: `Required degree (${reqEdu.degrees.join(", ")}) was not found in education history.`,
        suggestedAction: "Confirm and update your education qualifications if applicable.",
      });
    }
  }

  categories.push({
    name: "education_and_certifications",
    label: "Education & Certifications",
    score: eduScore,
    maxPoints: 5,
    percentage: Math.round((eduScore / 5) * 100),
    weight: 5,
    explanation: reqEdu && reqEdu.required
      ? (eduScore === 5 ? "Required educational criteria satisfied." : "Educational requirements need confirmation.")
      : "Education criteria satisfied.",
    matchedCount: eduScore === 5 ? 1 : 0,
    totalCount: 1,
    evidenceIds: eduEvidenceIds,
    redistributed: false,
  });

  // ==========================================
  // 7. ATS Readability & Completeness (Max 5 pts)
  // ==========================================
  let readabilityScore = 5;
  const sections = Array.isArray(resumeProfile.sectionsDetected) ? resumeProfile.sectionsDetected : [];
  if (!sections.includes("experience") && !sections.includes("skills")) {
    readabilityScore -= 2;
  }
  if (!resumeProfile.contact?.email) {
    readabilityScore -= 1;
  }
  readabilityScore = Math.max(readabilityScore, 1);

  categories.push({
    name: "ats_readability",
    label: "ATS Readability & Hygiene",
    score: readabilityScore,
    maxPoints: 5,
    percentage: Math.round((readabilityScore / 5) * 100),
    weight: 5,
    explanation: "Standard document sections, clean contact info, and clear structure.",
    matchedCount: sections.length,
    totalCount: 5,
    evidenceIds: [],
    redistributed: false,
  });

  // ==========================================
  // Overall Score Calculation (Exact 0..100 sum)
  // ==========================================
  const rawTotal = categories.reduce((sum, cat) => sum + cat.score, 0);
  const overallScore = Math.min(Math.max(Math.round(rawTotal), 0), 100);

  // Confidence calculation (based on data completeness)
  const confidence = resumeProfile.source?.extractionConfidence || 0.85;

  // Build actionable suggestions
  const suggestions = buildRoleFitSuggestions(categories, gaps, matchedRequirements);

  return {
    schemaVersion: ATS_ANALYSIS_VERSION,
    id: `ats-analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    applicationId: applicationId || null,
    resumeUploadId: resumeUploadId || "upload-default",
    resumeHash: resumeHash || (resumeProfile.source?.sha256 || "0000000000000000000000000000000000000000000000000000000000000000"),
    jobId: jobId || null,
    jobRevision: 1,
    calculatedAt: new Date().toISOString(),
    status: "completed",
    overallScore,
    confidence,
    categories,
    matchedRequirements,
    gaps,
    suggestions,
    exclusions: [
      { field: "protected_characteristics", reason: "Jobly strictly excludes race, gender, age, religion, and protected data from scoring." },
      { field: "institution_tier", reason: "Jobly does not rank candidates by college or university tier." },
    ],
    engine: {
      version: ATS_ANALYSIS_VERSION,
      rulesetHash: getRulesetHash(ATS_ANALYSIS_VERSION),
      taxonomyVersion: TAXONOMY_VERSION,
    },
  };
}

module.exports = {
  scoreRoleFit,
};
