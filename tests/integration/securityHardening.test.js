const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");

describe("Feature 15: Security Hardening & Input Validation", () => {
  let recruiterUser;
  let seekerUser;
  let sessionDoc;
  let recruiterToken;
  let seekerToken;
  let appDoc;

  beforeEach(async () => {
    seekerUser = await User.create({
      name: "Seeker Dev",
      email: `seeker_sec_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_sec",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_sec_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_sec",
    });

    const jobDoc = await Job.create({
      title: "Security Engineer",
      description: "Application security specialist with secure code review and cloud defense experience.",
      company: "SecureCloud",
      recruiter: recruiterUser._id,
      tenantId: "tenant_sec",
    });

    appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_sec",
    });

    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_sec",
      application: appDoc._id,
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      roomKey: `room-sec-test-${Date.now()}`,
      scheduledStart: new Date(),
      status: "LIVE",
    });

    seekerToken = jwt.sign(
      { id: seekerUser._id.toString(), userId: seekerUser._id.toString(), role: "seeker" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    recruiterToken = jwt.sign(
      { id: recruiterUser._id.toString(), userId: recruiterUser._id.toString(), role: "recruiter" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );
  });

  test("Test 1: should reject code execution with invalid language via Zod schema", async () => {
    const res = await request(app)
      .post(`/api/interviews/${sessionDoc._id}/execute`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({
        language: "malicious_binary_exec",
        code: "import os; os.system('ls')",
      });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe("Validation error");
    expect(res.body.errors[0].field).toBe("language");
  });

  test("Test 2: should reject code execution with empty code payload", async () => {
    const res = await request(app)
      .post(`/api/interviews/${sessionDoc._id}/execute`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({
        language: "python",
        code: "",
      });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe("Validation error");
  });

  test("Test 3: should reject interview stage transition with invalid stage enum", async () => {
    const res = await request(app)
      .patch(`/api/interviews/${sessionDoc._id}/stage`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({
        stage: "INVALID_HACKED_STAGE",
      });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe("Validation error");
  });

  test("Test 4: should reject interview schedule request with missing scheduledStart date", async () => {
    const res = await request(app)
      .post("/api/interviews/schedule")
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({
        applicationId: appDoc._id.toString(),
        scheduledStart: "not-a-valid-date",
      });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe("Validation error");
  });

  test("Test 5: should reject evaluation with out-of-range rating score (> 5)", async () => {
    const res = await request(app)
      .post(`/api/evaluations/${sessionDoc._id}`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({
        overallRating: 10, // Max is 5!
        decision: "HIRE",
      });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe("Validation error");
  });
});
