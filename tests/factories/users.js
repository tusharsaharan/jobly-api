const User = require("../../src/models/User");

async function createTestUser(overrides = {}) {
  const uniqueId = Math.random().toString(36).substring(2, 9);
  const defaults = {
    name: `User ${uniqueId}`,
    email: `user_${uniqueId}@example.com`,
    password: "password123",
    role: "seeker",
  };
  return await User.create({ ...defaults, ...overrides });
}

async function createTestRecruiter(overrides = {}) {
  return await createTestUser({ role: "recruiter", ...overrides });
}

async function createTestSeeker(overrides = {}) {
  return await createTestUser({ role: "seeker", ...overrides });
}

module.exports = {
  createTestUser,
  createTestRecruiter,
  createTestSeeker,
};
