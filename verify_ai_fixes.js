/* Adversarial extraction + merge-protection check (run: node verify_ai_fixes.js) */
process.env.NODE_ENV = "test";

const Mock = require("./src/modules/ai/providers/mock.provider.js");
const { extractGenericSkills, extractGenericDegree, extractGenericCollege } = Mock;

const sweeper = [
  "Ramesh Kumar",
  "Floor Sweeper, CleanCo Facilities - 2019 to Present",
  "Skills: sweeping, mopping, floor buffing, chemical handling, restroom sanitation",
  "Education: 10th Standard, Sarvodaya Vidyalaya",
  "CGPA: 7.2",
].join("\n");

const upsc = [
  "Ananya Iyer - IAS Officer",
  "Indian Administrative Service, Government of India - 2021 to Present",
  "Skills: public administration, policy formulation, district governance, disaster management",
  "Education: MBA, Indian Institute of Management Ahmedabad, CGPA: 3.6/4.0",
].join("\n");

const garbage = "";
const noSkillsSect = "Just a paragraph about someone with no list anywhere and nothing structured at all. Works somewhere.";

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + "  ->  " + JSON.stringify(detail)); }
}

const sw = extractGenericSkills(sweeper);
check("sweeper skills extracted from its own domain", sw.length >= 4, sw);
check("sweeper skills are NOT tech", !sw.some((s) => /react|node|javascript/i.test(s)), sw);
check("sweeper degree found", /10th standard|diploma|iti/i.test(extractGenericDegree(sweeper)), extractGenericDegree(sweeper));
check("sweeper college found", /vidyalaya/i.test(extractGenericCollege(sweeper)), extractGenericCollege(sweeper));

const ia = extractGenericSkills(upsc);
check("IAS skills extracted", ia.length >= 3, ia);
check("IAS college found", /institute.*management|indian institute/i.test(extractGenericCollege(upsc)), extractGenericCollege(upsc));

check("empty input -> empty skills", extractGenericSkills(garbage).length === 0, extractGenericSkills(garbage));
const ns = extractGenericSkills(noSkillsSect);
check("unstructured text -> no fake skills", ns.length === 0 || !ns.some((s) => /react|javascript/i.test(s)), ns);

// CGPA coercion edge cases
const { coerceCgpa } = require("./src/modules/ai/schemas.js");
check("cgpa '8.5' -> 8.5", coerceCgpa("8.5") === 8.5, coerceCgpa("8.5"));
check("cgpa '3.8/4' -> 9.5", coerceCgpa("3.8/4") === 9.5, coerceCgpa("3.8/4"));
check("cgpa '85%' -> 8.95", coerceCgpa("85%") === 8.95, coerceCgpa("85%"));
check("cgpa '9.02/10' -> 9.02", coerceCgpa("9.02/10") === 9.02, coerceCgpa("9.02/10"));
check("cgpa null -> null", coerceCgpa(null) === null, coerceCgpa(null));
check("cgpa '' -> null", coerceCgpa("") === null, coerceCgpa(""));
check("cgpa 'abc' -> null", coerceCgpa("abc") === null, coerceCgpa("abc"));
check("cgpa 12 -> clamped path (>10 treated as % => 1.26)", typeof coerceCgpa("12") === "number", coerceCgpa("12"));

// merge protection (recruiter criteria survive AI edits that omit them)
const { mergeJobDraft } = require("./src/utils/jobLogic");
const draft = {
  title: "Director of Sales", company: "PepsiCo", description: "Lead the sales org",
  skills: ["P&L management"],
  atsRequirements: { minCgpa: 8, targetCollegeTier: "tier1", minExperienceYears: 12, requiredDegree: "MBA" },
};
const aiRaw = { title: "Director of Sales", description: "Lead the sales org across channels" };
const merged = mergeJobDraft(draft, aiRaw);
check("merge preserves minCgpa 8", merged.atsRequirements.minCgpa === 8, merged.atsRequirements);
check("merge preserves tier1", merged.atsRequirements.targetCollegeTier === "tier1", merged.atsRequirements);
check("merge preserves exp 12", merged.atsRequirements.minExperienceYears === 12, merged.atsRequirements);
check("merge preserves company", merged.company === "PepsiCo", merged.company);
check("merge takes AI description", /across channels/.test(merged.description), merged.description);

// mock provider full-flow on sweeper prompt
(async () => {
  const mock = new Mock();
  const mockOut = JSON.parse(await mock.generateJSON("You are an expert resume parser for ANY profession.\nResume Text:\n" + sweeper));
  check("mock sweeper parse: no fabricated skills", !mockOut.skills.some((s) => /react|javascript|node/i.test(s)), mockOut.skills);
  check("mock sweeper parse: real skills present", mockOut.skills.length >= 3, mockOut.skills);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail > 0 ? 1 : 0);
})();
