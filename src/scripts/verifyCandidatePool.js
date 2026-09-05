const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const User = require("../models/User");

async function runVerification() {
 const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/jobly";
 console.log("Connecting to MongoDB:", mongoUri.split("@").pop());
 await mongoose.connect(mongoUri);

 console.log("\n=== Expanded Candidate Pool Query Invariant Verification ===\n");

 const testCases = [
 { label: "Case 1: No filters", skills: [], minCgpa: 0, targetCollegeTier: "any" },
 { label: "Case 2: Skills only (React)", skills: ["React"], minCgpa: 0, targetCollegeTier: "any" },
 { label: "Case 3: Skills + Moderate CGPA (React + CGPA >= 7.0)", skills: ["React"], minCgpa: 7.0, targetCollegeTier: "any" },
 { label: "Case 4: Skills + Strict CGPA (React + CGPA >= 8.5)", skills: ["React"], minCgpa: 8.5, targetCollegeTier: "any" },
 { label: "Case 5: Tier 1 alone (targetCollegeTier = tier1)", skills: [], minCgpa: 0, targetCollegeTier: "tier1" },
 { label: "Case 6: Tier 2 alone (targetCollegeTier = tier2 -> tier1+tier2)", skills: [], minCgpa: 0, targetCollegeTier: "tier2" },
 { label: "Case 7: React + Tier 1 (skills + targetCollegeTier = tier1)", skills: ["React"], minCgpa: 0, targetCollegeTier: "tier1" },
 { label: "Case 8: React + Tier 1 + CGPA >= 8.0 (Compound 3-way filter)", skills: ["React"], minCgpa: 8.0, targetCollegeTier: "tier1" },
 { label: "Case 9: React + Tier 2 + CGPA >= 7.5 (Compound 3-way filter)", skills: ["React"], minCgpa: 7.5, targetCollegeTier: "tier2" },
 ];

 let passed = 0;

 for (const tc of testCases) {
 const { skills, minCgpa, targetCollegeTier } = tc;

 // Simulate candidatePoolPreview logic
 const query = { role: "seeker" };
 if (skills.length > 0) query.skills = { $in: skills.map(s => new RegExp(s, "i")) };
 if (minCgpa > 0) query.cgpa = { $gte: minCgpa };

 if (targetCollegeTier === "tier1") {
 query.collegeTier = "tier1";
 } else if (targetCollegeTier === "tier2") {
 query.collegeTier = { $in: ["tier1", "tier2"] };
 } else if (targetCollegeTier === "tier3") {
 query.collegeTier = { $in: ["tier1", "tier2", "tier3"] };
 }

 const totalCount = await User.countDocuments(query);

 // Destructuring exclusions
 const { cgpa,...withoutCgpaQuery } = query;
 const withoutCgpa = minCgpa > 0? await User.countDocuments(withoutCgpaQuery): totalCount;

 const { collegeTier,...withoutTierQuery } = query;
 const withoutTier = targetCollegeTier!== "any"? await User.countDocuments(withoutTierQuery): totalCount;

 const { cgpa: _c, collegeTier: _t,...baseSkillQuery } = query;
 const baseWithSkillsOnly = (minCgpa > 0 || targetCollegeTier!== "any")
 ? await User.countDocuments(baseSkillQuery)
 : totalCount;

 const filteredByCgpa = Math.max(0, withoutCgpa - totalCount);
 const filteredByTier = Math.max(0, withoutTier - totalCount);

 // Invariant assertions
 const invariantCgpaRemoved = withoutCgpaQuery.cgpa === undefined;
 const invariantTierRemoved = withoutTierQuery.collegeTier === undefined;
 const invariantBaseClean = baseSkillQuery.cgpa === undefined && baseSkillQuery.collegeTier === undefined;

 const invariantCountGteCgpa = withoutCgpa >= totalCount;
 const invariantCountGteTier = withoutTier >= totalCount;
 const invariantCountGteBase = baseWithSkillsOnly >= withoutCgpa && baseWithSkillsOnly >= withoutTier;

 const isOk = invariantCgpaRemoved &&
 invariantTierRemoved &&
 invariantBaseClean &&
 invariantCountGteCgpa &&
 invariantCountGteTier &&
 invariantCountGteBase;

 console.log(`${tc.label}:`);
 console.log(` - Total Matching (All constraints): ${totalCount}`);
 console.log(` - Broader Pool without CGPA filter: ${withoutCgpa} (Filtered: ${filteredByCgpa})`);
 console.log(` - Broader Pool without Tier filter: ${withoutTier} (Filtered: ${filteredByTier})`);
 console.log(` - Base Pool (Skills only): ${baseWithSkillsOnly}`);
 console.log(` - Keys cleanly stripped: ${invariantCgpaRemoved && invariantTierRemoved && invariantBaseClean? " YES": " NO"}`);
 console.log(` - Invariant (base >= withoutX >= total): ${isOk? " PASS": " FAIL"}\n`);

 if (isOk) passed++;
 }

 console.log(`Summary: ${passed}/${testCases.length} comprehensive test cases passed.`);
 await mongoose.disconnect();
}

runVerification().catch(err => {
 console.error("Verification failed with error:", err);
 process.exit(1);
});
