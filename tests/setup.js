require("dotenv").config();
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

let mongoServer;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  process.env.MONGO_URI = mongoUri;
  process.env.JWT_SECRET = "testsecret123";

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
  }
  if (mongoServer) {
    await mongoServer.stop({ doCleanup: true, force: true });
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
  }),
  summarizeConversation: jest.fn().mockImplementation(() => {
    return Promise.resolve({
      summary: "The thread covered introductions and next steps for the role.",
      highlights: [
        "Candidate introduced themselves",
        "Interview availability discussed",
        "Next steps pending"
      ]
    });
  }),
  generateFocusQuiz: jest.fn().mockImplementation((topic, userProfile, opts) => {
    const count = Math.min(20, Math.max(1, Number(opts?.count) || 5));
    return Promise.resolve(Array.from({length: count}, (_,i)=>({ question: `Q${i+1} about ${topic}?`, options: ["A","B","C","D"], correctAnswer: 0, topic, difficulty: opts?.difficulty || "Medium", timeLimitSeconds: 20 })));
  }),
  generateCPProblem: jest.fn().mockImplementation((topic, opts) => {
    return Promise.resolve({ problemStatement: `CP Problem on ${topic}`, initialCode: "// solve", testCases: [{input:"1", expectedOutput:"1"}] });
  }),
  predictCandidateQuestions: jest.fn().mockImplementation((payload) => {
    return Promise.resolve([{ id: "q-1", question: "What is the team structure?", defaultAnswer: "Small team", category: "team_structure" }]);
  }),
  executeWithCascade: jest.fn().mockImplementation((prompt, schema, opts) => {
    return Promise.resolve({ success: true, data: { rewrittenDescription: "Improved description", improvements: [], summary: "Improved", questions: [] }, provider: "mock" });
  }),
  retrieve: jest.fn().mockImplementation((q, opts) => Promise.resolve([])),
  ragAnswer: jest.fn().mockImplementation((msg, chunks, opts) => Promise.resolve({ reply: "Mocked RAG answer", sources: [], confidence: 0.9 })),
};

jest.mock("../src/services/ai.service", () => mockAiMethods);
jest.mock("../src/modules/ai/aiService", () => mockAiMethods);
jest.mock("../src/services/rag.service", () => ({ retrieve: mockAiMethods.retrieve, ragAnswer: mockAiMethods.ragAnswer }));
jest.mock("../src/services/deiService", () => ({ rewriteForDei: jest.fn().mockImplementation((title, desc) => Promise.resolve({ rewrittenDescription: `Inclusive version of ${desc.slice(0,100)}`, improvements: [{ originalPhrase: "rockstar", replacementPhrase: "skilled specialist", reason: "Inclusive" }], summary: "Made inclusive" })) }));

