require("dotenv").config();
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

let mongoServer;

beforeAll(async () => {
  // Use in-memory MongoDB
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  process.env.MONGO_URI = mongoUri;
  process.env.JWT_SECRET = "testsecret123";

  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  // Clean all collections
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
});

// Mock AI service to avoid real Gemini calls during tests
const mockAiMethods = {
  computeAtsScore: jest.fn().mockImplementation((resumeText, jobDescription, jobSkills, candidateProfile, atsRequirements) => {
    return Promise.resolve({
      score: 85,
      breakdown: {
        skillMatch: 90,
        experienceRelevance: 80,
        educationFit: 90,
        projectsAndAchievements: 80,
        keywordOptimization: 85,
        overallPresentation: 85
      },
      tips: [
        "Include more metrics in your achievements.",
        "Add a few missing skills to match the job description completely."
      ]
    });
  }),
  parseResume: jest.fn().mockImplementation((text) => {
    return Promise.resolve({
      skills: ["javascript", "nodejs", "react", "mongodb", "express", "jest"],
      summary: "Experienced software engineer with full-stack capabilities.",
      education: {
        degree: "B.Tech Computer Science",
        college: "Indian Institute of Technology",
        tier: "tier1",
        cgpa: 9.1
      },
      achievements: [
        "Won first prize at national hackathon.",
        "Optimized database queries by 40%."
      ],
      experience: [
        {
          title: "Software Engineer Intern",
          company: "Tech Corp",
          duration: "May 2024 - July 2024"
        },
        {
          title: "Full Stack developer",
          company: "Freelance",
          duration: "1 year"
        }
      ]
    });
  }),
  generateJobFromPrompt: jest.fn().mockImplementation((prompt, draft) => {
    return Promise.resolve({
      title: "Senior Full Stack Engineer",
      company: "AI Innovations",
      description: "We are seeking a Senior Full Stack Engineer with strong Node.js, React and MongoDB skills to join our growing AI team.",
      skills: ["React", "Nodejs", "MongoDB", "TypeScript"],
      location: "Remote",
      type: "Full-time",
      atsRequirements: {
        minCgpa: 7.5,
        targetCollegeTier: "tier2",
        minExperienceYears: 3,
        requiredDegree: "B.Tech"
      }
    });
  })
};

jest.mock("../src/services/ai.service", () => mockAiMethods);
jest.mock("../src/modules/ai/aiService", () => mockAiMethods);

