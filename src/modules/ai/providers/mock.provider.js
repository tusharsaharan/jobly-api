const BaseAIProvider = require("./base.provider");
const { normalizeSkills, mergeJobDraft } = require("../../../utils/jobLogic");
const { coerceCgpa, coerceTier, coerceJobType } = require("../schemas");

/**
 * Generic text extraction helpers — domain-agnostic by design.
 * These power the offline fallback so a sweeper's resume yields sweeper
 * skills (or clean empty), never a fabricated tech profile.
 */

function extractGenericSkills(text) {
  const source = String(text || "");
  if (!source.trim()) return [];

  // 1) Explicit skills section (any domain): "Skills: a, b, c" / "SKILLS" heading
  const skillsSection = source.match(/skills?\s*[:\-—]\s*([\s\S]{0,600}?)(?:\n\s*\n|$)/i);
  if (skillsSection) {
    const items = skillsSection[1]
    .split(/[,;•|\n]/)
    .map((s) => s.replace(/\b proficient(?: in)?\b|[()]|^\s*[-•]\s*/gi, "").trim())
    .filter((s) => s.length > 1 && s.length <= 80);
    if (items.length > 0) return items.slice(0, 15);
  }

  // 2) Comma-separated short-noun runs (typical resume skill lines), e.g.
  //    "floor maintenance, chemical handling, team supervision"
  const lines = source.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const candidateLines = [];
  for (const line of lines) {
    // 2-6 comma-separated short phrases without sentence punctuation
    if (!/[.!?]$/.test(line) && line.length <= 160) {
      const parts = line.split(/,|;/).map((p) => p.trim());
      if (parts.length >= 2 && parts.every((p) => p.length > 1 && p.length <= 60)) {
        candidateLines.push(...parts);
      }
    }
  }
  if (candidateLines.length > 0) {
    const seen = new Set();
    const unique = [];
    for (const item of candidateLines) {
      const key = item.toLowerCase();
      if (!seen.has(key)) { seen.add(key); unique.push(item); }
      if (unique.length >= 15) break;
    }
    return unique;
  }

  return [];
}

function extractGenericDegree(text) {
  const source = String(text || "");
  // Prefer the "Education:" line when present — captures school-specific
  // qualifications like "10th Standard", "ITI", "MBBS", "LL.B" etc.
  const eduLine = source.match(/education\s*[:\-—]\s*([^\n]{0,160})/i);
  if (eduLine) {
    const m = eduLine[1].match(/\b(b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|b\.?\s?ba|m\.?\s?ba|b\.?\s?a|ll\.?\s?b|ll\.?\s?m|mba|mbbs|m\.?\s?pa|mph|ph\.?\s?d|doctorate|bachelor(?:'s)?(?:\s+of\s+\w+)?|master(?:'s)?(?:\s+of\s+\w+)?|b\.?\s?e\b|b\.?\s?arch|diploma|iti|polytechnic|10th\s+standard|12th\s+standard|sslc|cbse|icse|hsc|ssc)\b/i);
    if (m) return m[0].trim();
    // Education line without a recognized token: return its first clause as-is
    const clause = eduLine[1].split(/[,;–—]/)[0].trim();
    if (clause.length >= 2 && clause.length <= 80) return clause;
    return "";
  }
  const m = source.match(/\b(b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|b\.?\s?ba|m\.?\s?ba|b\.?\s?a|ll\.?\s?b|ll\.?\s?m|mba|mbbs|m\.?\s?pa|mph|ph\.?\s?d|doctorate|bachelor(?:'s)?(?:\s+of\s+\w+)?|master(?:'s)?(?:\s+of\s+\w+)?|b\.?\s?e\b|b\.?\s?arch|diploma|iti|polytechnic)\b[^\n,;]{0,80}/i);
  return m ? m[0].trim() : "";
}

function extractGenericCollege(text) {
  const source = String(text || "");
  // 1) Institution-type keywords (any case): college/university/institute/...
  const kw = source.match(/\b((?:[A-Za-z][\w&.'-]*\s+){0,4}(?:college|university|institute|institution|academy|polytechnic|vidyalaya|vidyalya|school|high school|secondary school|senior secondary)[^\n]{0,40})/i);
  if (kw) return kw[1].trim();
  // 2) "from <Institution>" / "at <Institution>" pattern
  const fromAt = source.match(/\b(?:from|at|studied at)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/);
  if (fromAt) return fromAt[1].trim();
  return "";
}

class MockRuleBasedProvider extends BaseAIProvider {
  constructor() {
    super("RuleBasedMock");
  }

  async isAvailable() {
    return true;
  }

  async generateJSON(prompt, options = {}) {
    const text = String(prompt || "");

    // Conversation summary request
    if (text.includes("Summarize the following private message thread")) {
      return JSON.stringify({
        summary: "This thread covered introductions, logistics, and next steps for the role.",
        highlights: [
          "Parties introduced themselves",
          "Availability and scheduling discussed",
          "Next steps pending review",
        ],
      });
    }

    // Candidate questions request — derive the title from the actual prompt
    if (text.includes("identify 4-5 high-signal questions")) {
      const titleMatch = text.match(/Title:\s*(.+)/i);
      const title = titleMatch ? titleMatch[1].trim() : "this role";
      return JSON.stringify({
        questions: [
          {
            id: "q-1",
            question: `What is the day-to-day team structure for the ${title} position?`,
            defaultAnswer: `As a ${title}, you will collaborate closely with cross-functional team members.`,
            category: "team_structure",
          },
          {
            id: "q-2",
            question: "What are the core tools and workflows used daily?",
            defaultAnswer: "Our team relies on established workflows with regular reviews and clear hand-offs.",
            category: "day_to_day",
          },
          {
            id: "q-3",
            question: `What does the growth path look like for a ${title}?`,
            defaultAnswer: "We offer structured performance cycles with clear milestones.",
            category: "growth_path",
          },
          {
            id: "q-4",
            question: "What are the working hours and location expectations?",
            defaultAnswer: "Details on schedule and location were not specified in the posting.",
            category: "logistics",
          },
        ],
      });
    }

    // DEI rewrite request — echo recruiter text, never tech boilerplate
    if (text.includes("Diversity, Equity, and Inclusion (DEI) talent acquisition consultant")) {
      const descMatch = text.match(/Original Job Description:\n"""\n([\s\S]*?)\n"""/i);
      const desc = descMatch ? descMatch[1].trim() : text;
      return JSON.stringify({
        rewrittenDescription: desc + "\n\nWe are an equal opportunity employer and welcome applications from all backgrounds.",
        improvements: [
          {
            originalPhrase: "various",
            replacementPhrase: "inclusive terms",
            reason: "Offline fallback: description preserved as written; inclusive closing added."
          }
        ],
        summary: "DEI rewrite applied via offline fallback (original text preserved).",
      });
    }

    // Resume parse request — generic extraction, zero hardcoded skills
    if (text.includes("You are an expert resume parser")) {
      const resumeBody = text.split("Resume Text:").pop() || "";
      const skills = extractGenericSkills(resumeBody);
      const degree = extractGenericDegree(resumeBody);
      const college = extractGenericCollege(resumeBody);
      const cgpaRaw = (resumeBody.match(/\b(?:cgpa|gpa)\s*[:=-]?\s*([0-9.]+(?:\s*\/\s*(?:4|10))?(?:\s*%)?)/i) || [])[1];
      const cgpa = coerceCgpa(cgpaRaw);

      return JSON.stringify({
        skills,
        experience: [],
        education: {
          degree,
          college,
          cgpa,
          tier: "unknown",
        },
        achievements: [],
        summary: resumeBody.trim()
          ? "Profile extracted via offline fallback parser. Review the detected details before relying on them."
          : "",
      });
    }

    // Job generation format — structure the recruiter's OWN text, never invent
    const recruiterMessage = (() => {
      const m = text.match(/Recruiter's message:\s*([\s\S]+)$/i);
      return m ? m[1].trim() : text.trim();
    })();
    const draftMatch = text.match(/Current draft:\s*(\{[\s\S]*?\})\s*Recruiter's message:/i);
    let draft = {};
    try { draft = draftMatch ? JSON.parse(draftMatch[1]) : {}; } catch { draft = {}; }

    const firstSentence = recruiterMessage.split(/[.!?\n]/).map((s) => s.trim()).find(Boolean) || "";
    const knownSkills = extractGenericSkills(recruiterMessage);

    return JSON.stringify({
      title: draft.title || (firstSentence ? firstSentence.slice(0, 80) : "New Role"),
      company: draft.company || "",
      location: draft.location || "",
      type: draft.type || coerceJobType(recruiterMessage) || "",
      description: recruiterMessage.length >= 20
        ? recruiterMessage
        : `Role description provided by recruiter: ${recruiterMessage}`,
      skills: normalizeSkills([...(draft.skills || []), ...knownSkills]),
      atsRequirements: {
        minCgpa: coerceCgpa(recruiterMessage.match(/(?:cgpa|gpa)\s*[:=\s]*([0-9.]+)/i)?.[1]) || 0,
        targetCollegeTier: coerceTier(draft.atsRequirements?.targetCollegeTier),
        minExperienceYears: Number(recruiterMessage.match(/(\d{1,2})\s*(?:\+)?\s*years?/i)?.[1]) || 0,
        requiredDegree: "",
      },
    });
  }
}

module.exports = MockRuleBasedProvider;
module.exports.extractGenericSkills = extractGenericSkills;
module.exports.extractGenericDegree = extractGenericDegree;
module.exports.extractGenericCollege = extractGenericCollege;
