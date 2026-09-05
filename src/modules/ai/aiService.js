const CircuitBreaker = require("opossum");
const logger = require("../../config/logger");
const providerFactory = require("./providers/provider.factory");
const { resumeExtractionSchema, jobGenerationSchema, candidateQuestionsSchema, conversationSummarySchema } = require("./schemas");
const { mergeJobDraft, normalizeJobPayload, normalizeSkills } = require("../../utils/jobLogic");

// Circuit breaker options per provider call
const breakerOptions = {
 timeout: 15000,
 errorThresholdPercentage: 50,
 resetTimeout: 30000,
};

function sanitizeJsonOutput(raw) {
 let clean = String(raw || "").trim();
 if (clean.startsWith("```")) {
 clean = clean.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
 }
 return clean;
}

class AIService {
 constructor() {
 this.breakers = new Map();
 }

 _getBreaker(provider) {
 if (!this.breakers.has(provider.name)) {
 const breaker = new CircuitBreaker(
 (prompt, options) => provider.generateJSON(prompt, options),
 breakerOptions
 );
 breaker.on("open", () => logger.warn({ provider: provider.name }, " AI Circuit Breaker opened! Failing over to next provider."));
 breaker.on("halfOpen", () => logger.info({ provider: provider.name }, " AI Circuit Breaker half-open, probing upstream health."));
 breaker.on("close", () => logger.info({ provider: provider.name }, " AI Circuit Breaker closed."));
 this.breakers.set(provider.name, breaker);
 }
 return this.breakers.get(provider.name);
 }

 /**
 * Execute prompt across failover cascade with Zod validation
 */
 async executeWithCascade(prompt, schema, options = {}) {
 const providers = await providerFactory.getProvidersCascade(options.preferredProvider);

 for (const provider of providers) {
 try {
 const breaker = this._getBreaker(provider);
 const rawResponse = await breaker.fire(prompt, options);
 const cleanJson = sanitizeJsonOutput(rawResponse);
 const parsed = JSON.parse(cleanJson);
 const validated = schema.safeParse(parsed);

 if (validated.success) {
 logger.debug({ provider: provider.name }, "AI execution and schema validation succeeded");
 // Include the raw parsed JSON so callers can distinguish fields the AI
 // explicitly returned from schema-defaulted fields (prevents the
 // default-wipe bug in mergeJobDraft).
 return { success: true, data: validated.data, raw: parsed, provider: provider.name };
 } else {
 logger.warn({ provider: provider.name, errors: validated.error.errors }, "AI output failed schema validation, trying next provider in cascade");
 }
 } catch (err) {
 logger.warn({ provider: provider.name, err: err.message }, "Provider invocation failed in cascade");
 }
 }

 // Emergency fallback: NEVER fabricate data. Return the schema's natural
 // empty shape (all-defaults) with an explicit degraded flag so callers
 // can distinguish "AI said nothing" from "nothing found".
 const fallbackParsed = schema.safeParse({}).success
 ? schema.parse({})
 : null;
 return { success: false, data: fallbackParsed, provider: "emergency-fallback", degraded: true };
 }

 /**
 * Parse Resume text with multi-provider failover and Zod validation
 */
 async parseResume(pdfText, options = {}) {
 const prompt = `
You are an expert resume parser for ANY profession — software, civil services, hospitality, retail, operations, manufacturing, academia, healthcare, administration, or any other occupation.
Analyze the provided resume text and extract ONLY what is actually present. Return strictly as a JSON object:
- "skills": Array of strings — the candidate's ACTUAL professional skills, competencies, or trade skills, whatever the domain (e.g., for a custodial role: floor maintenance, chemical handling; for an IAS officer: public administration, policy formulation). NEVER invent skills that are not evidenced in the text. Use the exact terminology the resume itself uses where possible. Max 15.
- "experience": Array of objects with { "title": string, "company": string, "duration": string } — only actual roles listed; use "" for unknown fields.
- "education": Object with { "degree": string, "college": string, "cgpa": number or null, "tier": "tier1" | "tier2" | "tier3" | "unknown" }. cgpa must be a plain number on a 10-point scale (convert 4-point scales by multiplying 2.5; percentages by dividing 9.5) or null when absent. tier refers to institutional prestige if determinable from the text, else "unknown".
- "achievements": Array of strings (max 5) — only real achievements stated in the resume.
- "summary": A 2-3 sentence professional summary grounded ONLY in the resume's actual content.
Rules: Empty or absent information MUST be empty strings, null, or empty arrays — never placeholder or invented values. Do not use any emojis.
Do not use any emojis in the output.

Resume Text:
${String(pdfText || "").slice(0, 15000)}
`;

 const result = await this.executeWithCascade(prompt, resumeExtractionSchema, options);
 // Propagate degradation so callers can react honestly (empty == nothing found).
 if (result.degraded) {
 const err = new Error("AI resume extraction unavailable — no providers succeeded");
 err.degraded = true;
 err.data = result.data;
 throw err;
 }
 return result.data;
 }

 /**
 * Generate Job posting draft with multi-provider failover and Zod validation
 */
 async generateJobFromPrompt(userPrompt, draft = {}, options = {}) {
 const currentDraft = normalizeJobPayload(draft);
 const outcomeContext = options.outcomeContext;

 const outcomePromptSection = outcomeContext? `
Platform Hiring Outcome Data (Verified on N=${outcomeContext.totalApplications} applicants across platform postings):
- Historical high-performing phrasing achieved an average ${outcomeContext.avgShortlistRate}% shortlist rate.
- High-performing tone/structural snippets from successful platform hires:
${outcomeContext.topSnippets.map((s, i) => `[Pattern ${i+1}]: ${s}`).join("\n")}
Adopt this clear, outcome-oriented framing and measurable responsibilities in the generated description.
`: "";

 const prompt = `
You are an expert recruiter assistant for ANY industry — technology, FMCG, retail, government, hospitality, manufacturing, academia, or any other sector.
Update the structured job posting from the recruiter's message. Return strictly as JSON:
- "title": Job title string.
- "company": Company name string.
- "location": Location string.
- "type": One of "", "Full-time", "Part-time", "Contract", "Internship".
- "description": Job description string.
- "skills": Array of required skills — whatever the role actually needs in its own domain (e.g., a custodial supervisor needs sanitation protocols and team supervision; a sales director needs P&L management and channel strategy). NEVER invent skills the recruiter did not imply.
- "atsRequirements": Object with minCgpa (number on 10-point scale), targetCollegeTier ("tier1"|"tier2"|"tier3"|"any"), minExperienceYears (number), requiredDegree (string).
Rules:
- The current draft is the source of truth. Preserve every existing value unless the recruiter asks to change or remove it.
- Never invent a company, location, skill, degree requirement, CGPA, college tier, or experience requirement.
- A degree is optional. Only set requiredDegree when the recruiter explicitly makes it mandatory.
- Do not turn a missing detail into a default such as "Remote" or "Full-time".
- Absent requirements must be 0 / "any" / "" — never fabricated.
Do not use any emojis in the output.
${outcomePromptSection}
Current draft:
${JSON.stringify(currentDraft)}

Recruiter's message:
${String(userPrompt || "").slice(0, 4000)}
`;

 const result = await this.executeWithCascade(prompt, jobGenerationSchema, options);
 // Merge against the RAW AI JSON so schema-injected defaults (0/"any"/"")
 // are treated as "AI didn't mention it" — never as explicit changes that
 // would wipe the recruiter's saved criteria.
 return mergeJobDraft(currentDraft, result.raw || result.data);
 }

 /**
 * Predict likely candidate questions and default FAQ answers for a job draft
 */
 async predictCandidateQuestions(jobPayload = {}, options = {}) {
 const prompt = `
You are a senior talent acquisition strategist for ANY industry or role type. Analyze this job posting and identify 4-5 high-signal questions that qualified candidates will ask before or during interviews.
Generate practical, transparent default answers based ONLY on the job details provided. Do not use emojis. If the posting lacks detail for an answer, say so honestly in the default answer.

Job Details:
Title: ${jobPayload.title || "the role"}
Company: ${jobPayload.company || "the organization"}
Location: ${jobPayload.location || "Not specified"}
Type: ${jobPayload.type || "Not specified"}
Skills: ${(jobPayload.skills || []).join(", ")}
Description:
${String(jobPayload.description || "").slice(0, 3000)}

Return strictly as JSON with this schema:
{
 "questions": [
 {
 "id": "q-1",
 "question": "What is the day-to-day team structure and reporting line?",
 "defaultAnswer": "You will collaborate closely with a cross-functional team of 4 engineers, a product manager, and a designer.",
 "category": "team_structure"
 }
 ]
}
`;

 const result = await this.executeWithCascade(prompt, candidateQuestionsSchema, options);
 return result.data?.questions || [];
 }

 /**
 * Summarize a private conversation thread (Instagram-style AI summary)
 */
 async summarizeConversation({ messages = [], participants = {}, jobContext = {}, maxMessages = 200 } = {}, options = {}) {
 const trimmed = Array.isArray(messages)? messages.slice(-maxMessages): [];
 const transcript = trimmed
 .map((m) => {
 const name = typeof m?.sender === "object"? m.sender?.name || m.sender?.email: null;
 const label = name? `${name}`: (m?.from || "Participant");
 return `${label}: ${String(m?.text || "").trim()}`;
 })
 .join("\n");

 const prompt = `
You are a helpful conversation assistant. Summarize the following private message thread like Instagram's chat summary.
Return strictly as JSON with this schema:
{
 "summary": "A single concise sentence capturing the overall state and outcome of the conversation.",
 "highlights": ["3 to 5 short bullet points covering key topics, decisions, scheduling, and action items."]
}

Rules:
- Stay strictly faithful to the transcript. Never invent facts, dates, or commitments that are not present.
- Cover what has been discussed, agreed, requested, and any pending next steps.
- Keep each highlight under ~12 words.
- Do not use emojis in the output.

Participants:
${Object.entries(participants).map(([k, v]) => `- ${k}: ${v || ""}`).join("\n") || "Unknown participants"}

Job Context:
${jobContext.title? `Title: ${jobContext.title}`: ""}${jobContext.company? `\nCompany: ${jobContext.company}`: ""}

Transcript (oldest to newest):
${transcript || "(no messages)"}
`;

 const result = await this.executeWithCascade(prompt, conversationSummarySchema, {
 preferredProvider: "gemini",
 temperature: 0.2,
 ...options,
 });
 return result.data;
 }
}

const aiService = new AIService();
module.exports = aiService;
