const jwt = require("jsonwebtoken");
const User = require("../../src/models/User");
const Job = require("../../src/models/Job");

async function createTestUser(attributes = {}) {
  const defaultUser = {
    name: "John Seeker",
    email: `seeker-${Math.random()}@example.com`,
    password: "password123",
    role: "seeker",
    skills: ["javascript", "nodejs", "react"],
    cgpa: 8.5,
    collegeTier: "tier2",
    college: "Test University",
    degree: "B.Tech Computer Science",
    experience: [{ title: "Intern", company: "A Corp", duration: "1 year" }]
  };
  return await User.create({ ...defaultUser, ...attributes });
}

async function createTestRecruiter(attributes = {}) {
  const defaultRecruiter = {
    name: "Alice Recruiter",
    email: `recruiter-${Math.random()}@example.com`,
    password: "password123",
    role: "recruiter",
  };
  return await User.create({ ...defaultRecruiter, ...attributes });
}

const config = require("../../src/config/env");

function getAuthToken(user) {
  const secret = config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678";
  return jwt.sign({ id: user._id, userId: user._id, role: user.role }, secret, { expiresIn: "7d" });
}

async function createTestJob(recruiterId, attributes = {}) {
  const defaultJob = {
    title: "Node.js Developer",
    company: "Tech Solutions",
    description: "We need a Node.js developer to build scalable API backends.",
    skills: ["javascript", "nodejs", "express"],
    location: "Remote",
    type: "Full-time",
    atsRequirements: {
      minCgpa: 7.0,
      targetCollegeTier: "tier3",
      minExperienceYears: 1,
      requiredDegree: "B.Tech"
    },
    recruiter: recruiterId
  };
  return await Job.create({ ...defaultJob, ...attributes });
}

module.exports = {
  createTestUser,
  createTestRecruiter,
  getAuthToken,
  createTestJob
};
