const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");
const configParser = require("../../src/services/interviewConfigParser");
const User = require("../../src/models/User");

describe("Feature 13: Interview Configuration DSL Parser & Formatter", () => {
  let recruiterUser;
  let recruiterToken;

  beforeEach(async () => {
    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_cfg_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_config",
    });

    recruiterToken = jwt.sign(
      { id: recruiterUser._id.toString(), userId: recruiterUser._id.toString(), role: "recruiter" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );
  });

  test("Test 1: should parse YAML-like DSL interview template", () => {
    const rawDsl = `
# System Design Interview
title: Distributed Cache Architecture
languages: python, go, typescript

stages:
  - SYSTEM_DESIGN
  - CODING
  - WRAP_UP

problems:
  - Design Distributed LRU Cache
  - Implement Consistent Hashing

weights:
  systemDesign: 0.50
  codeQuality: 0.30
  communication: 0.20
    `;

    const parsed = configParser.parseInterviewConfig(rawDsl);
    expect(parsed.title).toBe("Distributed Cache Architecture");
    expect(parsed.allowedLanguages).toEqual(["python", "go", "typescript"]);
    expect(parsed.stages.length).toBe(3);
    expect(parsed.problems.length).toBe(2);
    expect(parsed.scoringWeights.systemDesign).toBe(0.50);
  });

  test("Test 2: should parse JSON template and normalize missing attributes", () => {
    const rawJson = JSON.stringify({
      title: "Backend SWE",
      allowedLanguages: ["python"],
    });

    const parsed = configParser.parseInterviewConfig(rawJson);
    expect(parsed.title).toBe("Backend SWE");
    expect(parsed.allowedLanguages).toEqual(["python"]);
    expect(parsed.stages.length).toBeGreaterThan(0); // Defaults filled
  });

  test("Test 3: should format structured config object into clean human-readable DSL", () => {
    const configObj = {
      title: "Fullstack Interview",
      allowedLanguages: ["javascript", "python"],
      stages: [{ name: "CODING", durationMinutes: 30 }],
      problems: [{ title: "Two Sum" }],
      scoringWeights: { codeQuality: 0.5, problemSolving: 0.5 },
    };

    const formatted = configParser.formatInterviewConfig(configObj);
    expect(formatted).toContain("title: Fullstack Interview");
    expect(formatted).toContain("languages: javascript, python");
    expect(formatted).toContain("Two Sum");
  });

  test("Test 4: should parse config via POST /api/interviews/config/parse endpoint", async () => {
    const res = await request(app)
      .post("/api/interviews/config/parse")
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({
        content: "title: Realtime Chat\nlanguages: typescript, rust\nstages:\n  - CODING",
      });

    expect(res.status).toBe(200);
    expect(res.body.config.title).toBe("Realtime Chat");
    expect(res.body.config.allowedLanguages).toContain("rust");
  });

  test("Test 5: should reject empty content with 400 Bad Request", async () => {
    const res = await request(app)
      .post("/api/interviews/config/parse")
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({});

    expect(res.status).toBe(400);
  });
});
