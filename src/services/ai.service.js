const { GoogleGenAI } = require("@google/genai");
const {
  estimateExperienceYears,
  mergeJobDraft,
  normalizeJobPayload,
  normalizeSkills,
} = require("../utils/jobLogic");

// Lazy-init: don't crash at require-time if the key is missing
let _ai = null;
function getAI() {
  if (!_ai) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _ai;
}

exports.parseResume = async (pdfText) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.warn("No GEMINI_API_KEY found, falling back to basic parsing.");
      return basicParse(pdfText);
    }

    const prompt = `
You are an expert AI Resume Parser. Analyze the provided resume text and extract the following fields. Return strictly as a JSON object:

- "skills": Array of strings — professional/technical skills found (max 15).
- "experience": Array of objects with { "title": string, "company": string, "duration": string }. If not found, return empty array.
- "education": Object with { "degree": string, "college": string, "cgpa": number or null, "tier": "tier1" | "tier2" | "tier3" | "unknown" }. Classify Indian IITs, NITs, BITS, top IIMs as tier1. Other well-known universities as tier2. Remaining as tier3. If non-Indian or ambiguous, use "unknown".
- "achievements": Array of strings — certifications, awards, hackathon wins, publications, etc. Max 5.
- "summary": A 2-3 sentence professional summary of the candidate.

Important: For CGPA, only extract if clearly mentioned. Always return CGPA on a 10-point scale: keep a 10-point CGPA as-is, multiply a 4-point GPA by 2.5, and convert a percentage by dividing by 9.5. If the scale is unclear, return null rather than guessing.

Resume Text:
${pdfText}
`;

    const response = await getAI().models.generateContent({
      model: "gemini-flash-lite-latest",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    let text = response.text;
    if (text.startsWith("```")) {
      text = text.replace(/^```(json)?\n/, "").replace(/\n```$/, "");
    }

    return JSON.parse(text);
  } catch (error) {
    console.error("AI Parsing Error:", error.status, error.message);
    return basicParse(pdfText);
  }
};

exports.computeAtsScore = async (resumeText, jobDescription, jobSkills, candidateProfile, atsRequirements = {}) => {
  return basicAtsScore(resumeText, jobDescription, jobSkills, candidateProfile, atsRequirements);
};

exports.generateJobFromPrompt = async (userPrompt, draft = {}) => {
  const currentDraft = normalizeJobPayload(draft);
  try {
    if (!process.env.GEMINI_API_KEY) {
      return basicGenerateJob(userPrompt, currentDraft);
    }

    const prompt = `
You are a careful recruiter assistant. Update the structured job posting from the recruiter's message. Return strictly as JSON:
- "title": Job title string.
- "company": Company name string, or "" when deliberately absent.
- "location": Location string, or "" when deliberately absent.
- "type": One of "", "Full-time", "Part-time", "Contract", "Internship".
- "description": Job description string.
- "skills": Array of required skills.
- "atsRequirements": Object with:
    - "minCgpa": Number (0 means no CGPA requirement)
    - "targetCollegeTier": String, one of "tier1", "tier2", "tier3", "any"
    - "minExperienceYears": Number (0 means no experience requirement)
    - "requiredDegree": String ("" means no degree requirement)

Rules:
- The current draft is the source of truth. Preserve every existing value unless the recruiter asks to change or remove it.
- Never invent a company, location, skill, degree requirement, CGPA, college tier, or experience requirement.
- A degree is optional. Only set requiredDegree when the recruiter explicitly makes it mandatory.
- Do not turn a missing detail into a default such as "Remote" or "Full-time".
- If the recruiter provides a short brief, you may turn that brief into a clear description without claiming facts they did not provide.

Current draft:
${JSON.stringify(currentDraft)}

Recruiter's message:
${userPrompt.slice(0, 4000)}
`;

    const response = await getAI().models.generateContent({
      model: "gemini-flash-lite-latest",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    return mergeJobDraft(currentDraft, parseJsonObject(response.text));
  } catch (error) {
    console.error("AI Job Generation Error:", error.status || "", error.message);
    return basicGenerateJob(userPrompt, currentDraft);
  }
};

function basicParse(text) {
  const skillsList = [
    "javascript", "react", "node", "express", "mongodb", "sql",
    "python", "java", "c++", "html", "css", "git", "typescript",
    "docker", "aws", "kubernetes", "angular", "vue", "django", "flask",
  ];
  const source = String(text || "");
  const skills = skillsList.filter((skill) => source.toLowerCase().includes(skill));
  const degree = source.match(/\b(?:b\.?tech|m\.?tech|bachelor(?:'s)?(?:\s+of\s+(?:technology|engineering|science))?|master(?:'s)?(?:\s+of\s+(?:technology|engineering|science))?|mba|ph\.?d)\b[^\n,;]*/i)?.[0] || "";
  const cgpaMatch = source.match(/\b(?:cgpa|gpa)\s*[:=-]?\s*(10(?:\.0+)?|\d(?:\.\d+)?)(?:\s*\/\s*(4|10))?/i);
  const cgpa = cgpaMatch
    ? Number(cgpaMatch[1]) * (cgpaMatch[2] === "4" ? 2.5 : 1)
    : null;

  return {
    skills,
    experience: [],
    education: { degree, college: "", cgpa, tier: "unknown" },
    achievements: [],
    summary: source.trim() ? "Resume text was extracted. Review the detected profile details before relying on them." : "No readable resume text was found.",
  };
}

function basicAtsScore(resumeText, jobDescription, jobSkills, candidateProfile = {}, atsRequirements = {}) {
  const resume = String(resumeText || "").toLowerCase();
  const skills = normalizeSkills(jobSkills);
  const profileSkills = normalizeSkills(candidateProfile?.skills);
  const matchedSkills = skills.filter((skill) => {
    const normalizedSkill = comparable(skill);
    return profileSkills.some((candidateSkill) => skillsMatch(normalizedSkill, comparable(candidateSkill))) ||
      resumeIncludesSkill(resume, skill);
  });
  const skillMatch = skills.length > 0 ? Math.round((matchedSkills.length / skills.length) * 100) : 100;

  const jobKeywords = extractKeywords(`${jobDescription || ""} ${skills.join(" ")}`);
  const matchedKeywords = jobKeywords.filter((keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(resume));
  const keywordOptimization = jobKeywords.length > 0
    ? Math.round((matchedKeywords.length / jobKeywords.length) * 100)
    : 100;

  const totalExperience = estimateExperienceYears(candidateProfile?.experience);
  const minExperience = finiteNumber(atsRequirements?.minExperienceYears);
  const experienceText = (candidateProfile?.experience || [])
    .map((entry) => typeof entry === "string" ? entry : `${entry?.title || ""} ${entry?.company || ""} ${entry?.duration || ""}`)
    .join(" ")
    .toLowerCase();
  const roleKeywords = extractKeywords(jobDescription).slice(0, 12);
  const roleOverlap = roleKeywords.length > 0
    ? roleKeywords.filter((keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(experienceText)).length / roleKeywords.length
    : 1;
  const experienceRelevance = minExperience > 0
    ? clamp(Math.round(Math.min(1, totalExperience / minExperience) * 80 + roleOverlap * 20))
    : clamp(Math.round(70 + roleOverlap * 30));

  const educationFit = scoreEducation(candidateProfile, atsRequirements);
  const achievementEvidence = /\b(project|built|developed|certified|award|hackathon|published|launched|achievement)\b/i.test(resume) ||
    (Array.isArray(candidateProfile?.achievements) && candidateProfile.achievements.length > 0);
  const projectsAndAchievements = clamp(Math.round((achievementEvidence ? 65 : 35) + skillMatch * 0.35));
  const wordCount = resume.match(/[a-z0-9+#.]+/gi)?.length || 0;
  const hasSections = ["experience", "education", "skills", "project"].filter((heading) => resume.includes(heading)).length;
  const lengthScore = wordCount >= 250 && wordCount <= 1200 ? 85 : wordCount >= 120 ? 65 : 40;
  const overallPresentation = clamp(Math.round(lengthScore * 0.75 + Math.min(4, hasSections) * 6.25));
  const score = clamp(Math.round(
    skillMatch * 0.3 +
    experienceRelevance * 0.25 +
    educationFit * 0.15 +
    projectsAndAchievements * 0.15 +
    keywordOptimization * 0.1 +
    overallPresentation * 0.05,
  ));

  const missingSkills = skills.filter((skill) => !matchedSkills.includes(skill));
  const tips = [];
  if (missingSkills.length > 0) {
    tips.push(`Make relevant evidence of ${missingSkills.slice(0, 3).join(", ")} easy to find, only where it is accurate.`);
  }
  if (minExperience > totalExperience) {
    tips.push(`This role asks for ${minExperience} years of experience; make the scope and dates of your closest work explicit.`);
  }
  if (atsRequirements?.requiredDegree && !degreesMatch(candidateProfile?.degree, atsRequirements.requiredDegree)) {
    tips.push(`The role lists ${atsRequirements.requiredDegree} as required. Confirm your equivalent qualification clearly if you have one.`);
  }
  if (keywordOptimization < 60) {
    tips.push("Use the role's real responsibilities and terminology in relevant experience or project bullets.");
  }
  if (tips.length === 0) {
    tips.push("Keep your strongest matching skills and outcomes near the top of the resume.");
  }

  return {
    score,
    breakdown: { skillMatch, experienceRelevance, educationFit, projectsAndAchievements, keywordOptimization, overallPresentation },
    tips: tips.slice(0, 4),
  };
}

function scoreEducation(profile, requirements) {
  const scores = [];
  const requiredDegree = String(requirements?.requiredDegree || "").trim();
  const minCgpa = finiteNumber(requirements?.minCgpa);
  const requiredTier = String(requirements?.targetCollegeTier || "any").toLowerCase();

  if (requiredDegree) scores.push(degreesMatch(profile?.degree, requiredDegree) ? 100 : 0);
  if (minCgpa > 0) {
    const candidateCgpa = finiteNumber(profile?.cgpa);
    scores.push(candidateCgpa > 0 ? clamp(Math.round((candidateCgpa / minCgpa) * 100)) : 0);
  }
  if (["tier1", "tier2", "tier3"].includes(requiredTier)) {
    const ranks = { unknown: 0, tier3: 1, tier2: 2, tier1: 3 };
    scores.push((ranks[String(profile?.collegeTier || "unknown").toLowerCase()] || 0) >= ranks[requiredTier] ? 100 : 0);
  }

  return scores.length > 0 ? Math.round(scores.reduce((total, value) => total + value, 0) / scores.length) : 100;
}

function comparable(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9+#.]/g, "");
}

function skillsMatch(left, right) {
  const aliases = { node: "nodejs", nodejs: "nodejs", reactjs: "react", vuejs: "vue" };
  const normalizedLeft = aliases[left.replace(/[^a-z0-9]/g, "")] || left.replace(/[^a-z0-9]/g, "");
  const normalizedRight = aliases[right.replace(/[^a-z0-9]/g, "")] || right.replace(/[^a-z0-9]/g, "");
  return normalizedLeft === normalizedRight ||
    (normalizedLeft.length >= 5 && normalizedRight.length >= 5 &&
      (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)));
}

function resumeIncludesSkill(resume, skill) {
  const escaped = escapeRegExp(String(skill).toLowerCase()).replace(/\\ /g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9+#.])${escaped}(?=$|[^a-z0-9+#.])`, "i").test(resume);
}

function extractKeywords(text) {
  const stopWords = new Set(["about", "after", "against", "along", "also", "and", "are", "been", "being", "build", "candidate", "company", "deliver", "description", "experience", "from", "have", "ideal", "into", "job", "looking", "more", "must", "our", "role", "skills", "team", "that", "the", "their", "this", "through", "with", "work", "years", "you", "your"]);
  const seen = new Set();
  return String(text || "").toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g)?.filter((word) => {
    if (stopWords.has(word) || seen.has(word)) return false;
    seen.add(word);
    return true;
  }).slice(0, 30) || [];
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}

function degreesMatch(candidateDegree, requiredDegree) {
  const candidate = canonicalDegree(candidateDegree);
  const required = canonicalDegree(requiredDegree);
  return Boolean(candidate && required && (candidate === required || candidate.includes(required) || required.includes(candidate)));
}

function canonicalDegree(value) {
  const degree = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/(btech|bacheloroftechnology|bachelorofengineering|beengineering)/.test(degree)) return "btech";
  if (/(mtech|masteroftechnology|masterofengineering|meengineering)/.test(degree)) return "mtech";
  if (/(bsc|bachelorsofscience|bachelorscience)/.test(degree)) return "bsc";
  if (/(msc|masterofscience)/.test(degree)) return "msc";
  if (/mba|masterofbusinessadministration/.test(degree)) return "mba";
  if (/phd|doctorofphilosophy/.test(degree)) return "phd";
  return degree;
}

function basicGenerateJob(prompt, draft) {
  const text = String(prompt || "").trim();
  const lower = text.toLowerCase();
  const updates = {};
  const requirements = {};
  const knownSkills = [
    "React", "TypeScript", "JavaScript", "Node.js", "Express", "MongoDB", "SQL",
    "Python", "Java", "C++", "AWS", "Docker", "Kubernetes", "Angular", "Vue",
    "Django", "Flask", "Postgres", "GraphQL", "Next.js", "HTML", "CSS",
  ];
  const title = findLabeledValue(text, ["job title", "title", "role", "position"]) || extractRole(text);
  if (title) updates.title = title;

  const company = findLabeledValue(text, ["company", "organization", "employer"]) ||
    text.match(/\bat\s+([A-Z][A-Za-z0-9&.\- ]{1,60}?)(?=\s+(?:in|with|requiring|needs)\b|[,.\n]|$)/)?.[1];
  if (company) updates.company = company;
  if (/\b(?:clear|remove)\s+(?:the\s+)?company\b/i.test(text)) updates.company = "";

  const location = findLabeledValue(text, ["location", "work location", "workplace"]) ||
    text.match(/\b(remote|hybrid)\b/i)?.[1] ||
    text.match(/\b(?:based\s+in|location\s+is|in)\s+([A-Z][A-Za-z .'-]{1,60}?)(?=[,.\n]|$)/)?.[1];
  if (location) updates.location = location;
  if (/\b(?:clear|remove)\s+(?:the\s+)?location\b/i.test(text)) updates.location = "";

  if (/\b(?:full[ -]?time|\bfte\b|permanent)\b/i.test(text)) updates.type = "Full-time";
  else if (/\bpart[ -]?time\b/i.test(text)) updates.type = "Part-time";
  else if (/\b(?:contract|freelance)\b/i.test(text)) updates.type = "Contract";
  else if (/\b(?:intern|trainee)\b/i.test(text)) updates.type = "Internship";
  if (/\b(?:clear|remove)\s+(?:the\s+)?(?:employment\s+)?type\b/i.test(text)) updates.type = "";

  const labeledSkills = findLabeledValue(text, ["skills", "tech stack", "stack", "requirements"]);
  const mentionedSkills = knownSkills.filter((skill) => new RegExp(`\\b${escapeRegExp(skill).replace(/\\ /g, "\\s+")}\\b`, "i").test(text));
  const skills = normalizeSkills([...(labeledSkills ? labeledSkills.split(/[,;|]/) : []), ...mentionedSkills]);
  if (labeledSkills || mentionedSkills.length > 0) updates.skills = skills;
  if (/\b(?:clear|remove)\s+(?:the\s+)?skills?\b/i.test(text)) updates.skills = [];

  const description = findLabeledBlock(text, ["description", "about the role", "responsibilities"]);
  if (description) updates.description = description;
  else if (!normalizeJobPayload(draft).description && text.length >= 20) updates.description = text;

  const cgpaMatch = text.match(/\b(?:minimum|min|required|at least)\s*(?:cgpa|gpa)\s*(?:of|>=|:)?\s*(\d+(?:\.\d+)?)/i) ||
    text.match(/\b(?:cgpa|gpa)\s*(?:of|>=|:)?\s*(\d+(?:\.\d+)?)/i);
  if (cgpaMatch) requirements.minCgpa = Number(cgpaMatch[1]);
  if (/\b(?:no|without)\s+(?:minimum\s+)?(?:cgpa|gpa)\b|\b(?:clear|remove)\s+(?:the\s+)?(?:cgpa|gpa)\b/i.test(text)) requirements.minCgpa = 0;

  const experienceMatch = text.match(/\b(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\b/i);
  if (experienceMatch) requirements.minExperienceYears = Number(experienceMatch[1]);
  if (/\b(?:no|without)\s+(?:minimum\s+)?experience\b|\b(?:clear|remove)\s+(?:the\s+)?experience\b/i.test(text)) requirements.minExperienceYears = 0;

  const tierMatch = text.match(/\btier\s*([123])(?:\s+or\s+better)?\b/i);
  if (tierMatch) requirements.targetCollegeTier = `tier${tierMatch[1]}`;
  if (/\b(?:any|no)\s+(?:college\s+)?tier\b|\b(?:clear|remove)\s+(?:the\s+)?(?:college\s+)?tier\b/i.test(text)) requirements.targetCollegeTier = "any";

  if (/\b(?:no|without)\s+(?:degree|degree requirement)\b|\bdegree\s+(?:optional|not required)\b|\b(?:clear|remove)\s+(?:the\s+)?degree\b/i.test(text)) {
    requirements.requiredDegree = "";
  } else {
    const degreeMatch = text.match(/\b(?:required|must have|need(?:s)?|minimum)\s+(?:a\s+)?((?:b\.?tech|m\.?tech|bachelor(?:'s)?(?:\s+of\s+(?:technology|engineering|science))?|master(?:'s)?(?:\s+of\s+(?:technology|engineering|science))?|mba|ph\.?d)[^,.\n;]*)/i) ||
      text.match(/\bdegree\s*[:=-]?\s*((?:b\.?tech|m\.?tech|bachelor(?:'s)?(?:\s+of\s+(?:technology|engineering|science))?|master(?:'s)?(?:\s+of\s+(?:technology|engineering|science))?|mba|ph\.?d)[^,.\n;]*)/i);
    if (degreeMatch) requirements.requiredDegree = degreeMatch[1];
  }

  if (Object.keys(requirements).length > 0) updates.atsRequirements = requirements;
  return mergeJobDraft(draft, updates);
}

function parseJsonObject(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Assistant returned an invalid response.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Assistant returned an invalid response.");
  }
  return parsed;
}

function findLabeledValue(text, labels) {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const match = text.match(new RegExp(`(?:^|\\n|[|;])\\s*(?:${labelPattern})\\s*[:=-]\\s*([^\\n|;]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function findLabeledBlock(text, labels) {
  const value = findLabeledValue(text, labels);
  if (value) return value;
  const labelPattern = labels.map(escapeRegExp).join("|");
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:=-]\\s*([\\s\\S]+?)(?=\\n\\s*[A-Za-z ]+\\s*[:=-]|$)`, "i"));
  return match?.[1]?.trim() || "";
}

function extractRole(text) {
  const directMatch = text.match(/\b(?:hiring|hire|looking for|need|opening for|role for|position for)\s+(?:an?\s+)?([^,.\n]+?)(?=\s+(?:at|in|with|for|requiring|needs)\b|[,.\n]|$)/i);
  if (directMatch?.[1]) return directMatch[1].trim();

  const firstLine = text.split(/\r?\n/)[0]?.trim() || "";
  const roleWord = /\b(?:engineer|developer|designer|analyst|manager|specialist|consultant|administrator|architect|intern|lead|researcher|writer|marketer|recruiter)\b/i;
  if (roleWord.test(firstLine)) {
    return firstLine.split(/\s+(?:at|in|with|for|requiring|needs)\b|[,;|]/i)[0].trim();
  }
  return "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
