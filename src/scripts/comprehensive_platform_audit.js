const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

// Load models
const User = require("../models/User");
const Job = require("../models/Job");
const Application = require("../models/Application");
const InterviewSession = require("../models/InterviewSession");
const Evaluation = require("../models/Evaluation");
const TimelineEvent = require("../models/TimelineEvent");
const RequirementBlock = require("../models/RequirementBlock");

// Load services
const aiService = require("../modules/ai/aiService");
const requirementsFlagService = require("../services/requirementsFlagService");
const healthScoreService = require("../services/healthScoreService");
const timeToFillService = require("../services/timeToFillService");
const deiService = require("../services/deiService");
const { computeAtsScore } = require("../services/ai.service");
const { scoreResumeHealth } = require("../modules/ats");
const jobController = require("../controllers/job.controller");
const dashboardController = require("../controllers/dashboard.controller");

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://tusharsaharan:Tus1234@cluster0.41myqti.mongodb.net/jobmatch?appName=Cluster0";

async function runAudit() {
  console.log("Connecting to MongoDB for comprehensive audit...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected successfully.\n");

  const results = {};

  // ==========================================
  // SECTION A: Resume & Profile Intelligence
  // ==========================================
  console.log("--- RUNNING SECTION A AUDIT ---");
  
  // A1: Resume parsing behavior on missing fields & DOCX vs PDF
  const resumeWithMissingFields = `
John Doe
Software Engineer with 4 years experience in Node.js and React.
Experience:
- Senior Developer at Acme Corp (2021 - Present)
- Junior Developer at Beta LLC (2019 - 2021)
Skills: JavaScript, Node.js, React, MongoDB, Docker
Education:
Computer Science graduate. (No CGPA, no university mentioned)
  `;
  const parsedSparseResume = await aiService.parseResume(resumeWithMissingFields, { preferredProvider: "gemini" });
  console.log("A1 Sparse Resume Parse Output:", JSON.stringify(parsedSparseResume, null, 2));

  // A2: College tier classification
  const testInstitutions = ["IIT Bombay", "BITS Pilani", "Delhi University", "Random Unknown College 1234"];
  const collegeTierResults = [];
  for (const inst of testInstitutions) {
    const prompt = `Classify this college into tier1, tier2, tier3, or unknown. College: "${inst}". Return strictly JSON { "tier": "tier1"|"tier2"|"tier3"|"unknown" }`;
    const res = await aiService.executeWithCascade(prompt, require("zod").object({ tier: require("zod").enum(["tier1", "tier2", "tier3", "unknown"]) }));
    collegeTierResults.push({ institution: inst, classifiedTier: res.data?.tier || "unknown" });
  }
  console.log("A2 College Tier Classification:", collegeTierResults);

  // A3: Profile Health Gauge
  const sparseProfile = {
    skills: ["React"],
    experience: [],
    degree: "",
    college: "",
    cgpa: null,
    resumeSummary: ""
  };
  const completeProfile = {
    skills: ["React", "Node.js", "TypeScript", "MongoDB", "Docker", "AWS"],
    experience: [
      { title: "Senior Full Stack Engineer", company: "Stripe", duration: "2021 - Present" },
      { title: "Software Engineer", company: "Uber", duration: "2019 - 2021" }
    ],
    degree: "B.Tech Computer Science",
    college: "IIT Bombay",
    cgpa: 9.2,
    resumeSummary: "Accomplished distributed systems engineer with 5+ years specializing in high-throughput backend services and modern reactive frontends."
  };
  const sparseHealth = scoreResumeHealth ? scoreResumeHealth(sparseProfile) : "scoreResumeHealth not directly exported";
  const completeHealth = scoreResumeHealth ? scoreResumeHealth(completeProfile) : "scoreResumeHealth not directly exported";
  console.log("A3 Sparse Profile Health:", sparseHealth);
  console.log("A3 Complete Profile Health:", completeHealth);

  // A4: ATS Compatibility Matcher
  const targetJob = {
    title: "Senior Backend Engineer",
    description: "Looking for an engineer with strong Node.js, Distributed Systems, MongoDB, and Redis experience.",
    skills: ["Node.js", "MongoDB", "Redis", "Distributed Systems", "Docker"],
    atsRequirements: { minCgpa: 7.0, targetCollegeTier: "any", minExperienceYears: 3 }
  };
  const strongCandidate = {
    skills: ["Node.js", "MongoDB", "Redis", "Distributed Systems", "Docker", "AWS"],
    cgpa: 8.5,
    collegeTier: "tier1",
    experience: [{ title: "Backend Engineer", duration: "4 years" }]
  };
  const poorCandidate = {
    skills: ["Graphic Design", "Photoshop", "Figma", "Canva"],
    cgpa: 6.0,
    collegeTier: "tier3",
    experience: [{ title: "UI Designer", duration: "1 year" }]
  };
  const strongAts = await computeAtsScore(strongCandidate, targetJob);
  const poorAts = await computeAtsScore(poorCandidate, targetJob);
  console.log("A4 Strong Match ATS:", strongAts);
  console.log("A4 Poor Match ATS:", poorAts);

  // ==========================================
  // SECTION B: Job Discovery & Applications
  // ==========================================
  console.log("\n--- RUNNING SECTION B AUDIT ---");
  
  // B1: Curated Job Feed Filters
  const totalJobsCount = await Job.countDocuments();
  const reactJobs = await Job.countDocuments({ skills: { $in: [/^React$/i] } });
  const nodeJobs = await Job.countDocuments({ skills: { $in: [/^Node\.js$/i] } });
  const remoteJobs = await Job.countDocuments({ location: { $regex: /remote/i } });
  const fullTimeJobs = await Job.countDocuments({ type: "Full-time" });
  const highSalaryJobs = await Job.countDocuments({ "salaryRange.min": { $gte: 150000 } });
  const compoundJobs = await Job.countDocuments({
    skills: { $in: [/^React$/i] },
    location: { $regex: /remote/i },
    type: "Full-time"
  });
  console.log("B1 Job Feed Counts:", {
    totalJobs: totalJobsCount,
    reactJobs,
    nodeJobs,
    remoteJobs,
    fullTimeJobs,
    highSalaryJobs,
    compoundReactRemoteFullTime: compoundJobs
  });

  // B2: Application Stage Transitions
  const sampleApp = await Application.findOne().lean();
  console.log("B2 Sample Application in DB:", sampleApp ? { id: sampleApp._id, status: sampleApp.status, atsScore: sampleApp.atsScore } : "None found");

  // ==========================================
  // SECTION C: Recruiter Intelligence Suite
  // ==========================================
  console.log("\n--- RUNNING SECTION C AUDIT ---");

  // Auto-flag Semantic Checks on 3 test descriptions
  const contradictionDesc = {
    title: "Junior Entry-Level Software Engineer",
    type: "Full-time",
    atsRequirements: { minExperienceYears: 10 },
    description: "Seeking an entry-level graduate with minimum 10 years of professional production Kubernetes and Rust architecture experience to manage our core infrastructure."
  };
  const cleanDesc = {
    title: "Senior Full Stack Engineer",
    type: "Full-time",
    atsRequirements: { minExperienceYears: 4 },
    description: "We are seeking a Senior Full Stack Engineer with 4+ years of experience in React and Node.js to build scalable web applications. You will collaborate closely with product design and engineering."
  };
  const ambiguousDesc = {
    title: "Software Specialist",
    type: "Full-time",
    atsRequirements: { minExperienceYears: 2 },
    description: "Looking for an energetic rockstar engineer who can handle everything from frontend to devops and sales engineering."
  };

  const flagContradiction = await requirementsFlagService.getSemanticFlags(contradictionDesc);
  const flagClean = await requirementsFlagService.getSemanticFlags(cleanDesc);
  const flagAmbiguous = await requirementsFlagService.getSemanticFlags(ambiguousDesc);

  console.log("C2 Contradiction Flags:", flagContradiction);
  console.log("C2 Clean Flags:", flagClean);
  console.log("C2 Ambiguous Flags:", flagAmbiguous);

  // Health Score on 3 test job postings
  const incompleteJob = {
    title: "Dev",
    description: "Need someone to code stuff.",
    skills: ["Code"],
    company: "",
    location: "",
    salaryRange: { visible: false }
  };
  const biasedJob = {
    title: "Rockstar Ninja Full Stack Developer",
    company: "Apex Hyper Growth",
    location: "San Francisco, CA",
    type: "Full-time",
    skills: ["React", "Node.js", "TypeScript", "GraphQL"],
    atsRequirements: { minExperienceYears: 3, minCgpa: 8.0 },
    salaryRange: { min: 120000, max: 280000, visible: true },
    description: "We are looking for a dominant 10x rockstar coding ninja who will crush it in our high-energy culture. You must be a digital native who fits seamlessly into our brotherhood of hackers."
  };
  const optimizedJob = {
    title: "Senior Distributed Systems Engineer",
    company: "CloudScale Technologies",
    location: "Remote",
    type: "Full-time",
    skills: ["Go", "Kubernetes", "gRPC", "PostgreSQL", "Kafka"],
    atsRequirements: { minExperienceYears: 5, minCgpa: 7.0, targetCollegeTier: "any" },
    salaryRange: { min: 165000, max: 195000, currency: "USD", period: "annual", visible: true },
    description: "CloudScale is seeking a Senior Distributed Systems Engineer to design, implement, and maintain high-throughput streaming pipelines. We value collaborative problem solving, proactive communication, and continuous learning."
  };

  const scoreIncomplete = await healthScoreService.calculateHealthScore(incompleteJob);
  const biasBiased = await healthScoreService.getBiasScore(biasedJob);
  const scoreBiased = await healthScoreService.calculateHealthScore(biasedJob, biasBiased.score);
  const biasOptimized = await healthScoreService.getBiasScore(optimizedJob);
  const scoreOptimized = await healthScoreService.calculateHealthScore(optimizedJob, biasOptimized.score);

  console.log("C3 Incomplete Health Score:", scoreIncomplete);
  console.log("C3 Biased Health Score:", scoreBiased);
  console.log("C3 Optimized Health Score:", scoreOptimized);

  // Time-to-Fill Compounding Modifiers Test
  const allPositiveJob = {
    title: "Senior Frontend Engineer",
    skills: ["React", "TypeScript", "TailwindCSS", "Next.js"],
    location: "Remote",
    salaryRange: { min: 150000, max: 180000, visible: true },
    atsRequirements: { minExperienceYears: 3, minCgpa: 0, targetCollegeTier: "any" }
  };
  const allNegativeJob = {
    title: "Staff Systems Architect",
    skills: ["C++", "Rust", "Go", "Java", "Python", "Kubernetes", "Docker", "Kafka", "PostgreSQL", "Cassandra", "AWS", "GCP", "Linux", "eBPF"],
    location: "On-site",
    salaryRange: { visible: false },
    atsRequirements: { minExperienceYears: 8, minCgpa: 9.0, targetCollegeTier: "tier1" }
  };
  const ttfPositive = await timeToFillService.predictTimeToFill(allPositiveJob);
  const ttfNegative = await timeToFillService.predictTimeToFill(allNegativeJob);
  console.log("C4 Time-to-Fill All-Positive:", ttfPositive);
  console.log("C4 Time-to-Fill All-Negative:", ttfNegative);

  // DEI Rewrite on 3 test descriptions
  const deiHeavyText = "Looking for a 10x rockstar and coding ninja who has a dominant mindset and will be a great culture fit. Must be a digital native ready to grind.";
  const deiNeutralText = "We are seeking a skilled Senior Software Engineer to design, build, and maintain scalable cloud microservices. Candidates will collaborate with cross-functional teams to deliver reliable software solutions.";
  const deiBorderlineText = "Seeking a high-energy developer with strong technical chops who fits seamlessly into our fast-paced startup culture.";

  try {
    const deiHeavyResult = await deiService.rewriteForDei("Senior Developer", deiHeavyText);
    console.log("C5 DEI Heavy Rewrite:", deiHeavyResult);
  } catch (err) {
    console.log("C5 DEI Heavy Rewrite Error (Cascade failure to Mock):", err.message);
  }
  try {
    const deiNeutralResult = await deiService.rewriteForDei("Senior Software Engineer", deiNeutralText);
    console.log("C5 DEI Neutral Rewrite:", deiNeutralResult);
  } catch (err) {
    console.log("C5 DEI Neutral Rewrite Error:", err.message);
  }
  try {
    const deiBorderlineResult = await deiService.rewriteForDei("Developer", deiBorderlineText);
    console.log("C5 DEI Borderline Rewrite:", deiBorderlineResult);
  } catch (err) {
    console.log("C5 DEI Borderline Rewrite Error:", err.message);
  }

  // Data Quality Spot Check
  const reactCandidates = await User.find({ skills: { $in: [/^React$/i] } }).select("name email collegeTier cgpa").lean();
  const distinctTiers = [...new Set(reactCandidates.map(c => c.collegeTier))];
  console.log("C7 React Candidates distinct tiers in DB:", distinctTiers, "Total React count:", reactCandidates.length);

  // ==========================================
  // SECTION D: Recruiter Operations & Analytics
  // ==========================================
  console.log("\n--- RUNNING SECTION D AUDIT ---");
  const recruiters = await User.find({ role: "recruiter" }).select("_id name email").lean();
  console.log("D2 Recruiters in DB:", recruiters.length);
  for (const r of recruiters.slice(0, 3)) {
    const jCount = await Job.countDocuments({ recruiter: r._id });
    const appCount = await Application.countDocuments({ recruiter: r._id });
    const sessCount = await InterviewSession.countDocuments({ recruiter: r._id });
    console.log(`Recruiter ${r.name} (${r._id}): ${jCount} jobs, ${appCount} applications, ${sessCount} interview sessions`);
  }

  await mongoose.disconnect();
  console.log("\nAudit execution finished.");
}

runAudit().catch(err => {
  console.error("Audit error:", err);
  process.exit(1);
});
