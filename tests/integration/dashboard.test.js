const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const Evaluation = require("../../src/models/Evaluation");

describe("Feature 9: Recruiter Dashboard & Aggregations", () => {
  let seekerUser;
  let recruiterUser;
  let sessionDoc1;
  let sessionDoc2;
  let recruiterToken;
  let seekerToken;

  beforeEach(async () => {
    seekerUser = await User.create({
      name: "Seeker Dev",
      email: `seeker_dash_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_dash",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_dash_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_dash",
    });

    const jobDoc = await Job.create({
      title: "Senior Full Stack Lead",
      description: "Looking for principal engineer.",
      company: "Scalable Systems",
      recruiter: recruiterUser._id,
      tenantId: "tenant_dash",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_dash",
    });

    sessionDoc1 = await InterviewSession.create({
      tenantId: "tenant_dash",
      application: appDoc._id,
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      roomKey: `room-dash-1-${Date.now()}`,
      scheduledStart: new Date(),
      status: "LIVE",
    });

    sessionDoc2 = await InterviewSession.create({
      tenantId: "tenant_dash",
      application: appDoc._id,
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      roomKey: `room-dash-2-${Date.now()}`,
      scheduledStart: new Date(),
      status: "COMPLETED",
    });

    await Evaluation.create({
      session: sessionDoc2._id,
      evaluator: recruiterUser._id,
      overallRating: 5,
      decision: "STRONG_HIRE",
      competencies: [
        {
          category: "Algorithms",
          score: 5,
          evidenceRefs: [{ refType: "TRANSCRIPT", quote: "Perfect explanation" }],
        },
      ],
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

  test("Test 1: should fetch aggregated recruiter dashboard KPI metrics", async () => {
    const res = await request(app)
      .get("/api/dashboard/stats")
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalSessions).toBe(2);
    expect(res.body.liveSessions).toBe(1);
    expect(res.body.completedSessions).toBe(1);
    expect(res.body.decisionsCount.STRONG_HIRE).toBe(1);
  });

  test("Test 2: should fetch dashboard interviews with attached evaluation scorecards", async () => {
    const res = await request(app)
      .get("/api/dashboard/interviews")
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.interviews.length).toBe(2);

    const completed = res.body.interviews.find((s) => s.status === "COMPLETED");
    expect(completed).toBeDefined();
    expect(completed.evaluation).not.toBeNull();
    expect(completed.evaluation.decision).toBe("STRONG_HIRE");
  });

  test("Test 3: should filter dashboard interviews by status", async () => {
    const res = await request(app)
      .get("/api/dashboard/interviews?status=LIVE")
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.interviews.length).toBe(1);
    expect(res.body.interviews[0].status).toBe("LIVE");
  });

  test("Test 4: should return seeker-specific interview sessions when queried by seeker", async () => {
    const res = await request(app)
      .get("/api/dashboard/interviews")
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.interviews.length).toBe(2);
    expect(res.body.interviews[0].seeker._id.toString()).toBe(seekerUser._id.toString());
  });

  test("Test 5: should reject unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/dashboard/stats");
    expect(res.status).toBe(401);
  });
});
