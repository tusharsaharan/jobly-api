const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const TimelineEvent = require("../../src/models/TimelineEvent");
const InterviewSignal = require("../../src/models/InterviewSignal");

describe("Signals REST API Integration Tests", () => {
  let seekerUser;
  let recruiterUser;
  let sessionDoc;
  let recruiterToken;
  let seekerToken;

  beforeEach(async () => {
    seekerUser = await User.create({
      name: "Alice Engineer",
      email: `alice_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
    });

    recruiterUser = await User.create({
      name: "Bob Recruiter",
      email: `bob_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
    });

    const jobDoc = await Job.create({
      title: "Senior Backend Engineer",
      description: "Node.js and Distributed Systems role.",
      company: "Cloud Systems Inc",
      recruiter: recruiterUser._id,
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      status: "applied",
    });

    sessionDoc = await InterviewSession.create({
      job: jobDoc._id,
      application: appDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      scheduledStart: new Date(),
      status: "LIVE",
      roomKey: `room_${Date.now()}`,
    });

    const secret = config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678";
    recruiterToken = jwt.sign({ id: recruiterUser._id, role: "recruiter" }, secret);
    seekerToken = jwt.sign({ id: seekerUser._id, role: "seeker" }, secret);
  });

  describe("POST /api/signals/extract", () => {
    it("should extract signals from code and execution payload", async () => {
      const res = await request(app)
        .post("/api/signals/extract")
        .set("Authorization", `Bearer ${recruiterToken}`)
        .send({
          sessionId: sessionDoc._id,
          code: "const map = new Map(); const seen = new Set();",
          language: "javascript",
          executionResult: { exitCode: 0 },
          testCaseResults: [{ passed: true, input: "1", expectedOutput: "1", actualOutput: "1" }],
          offsetMs: 15000,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);
      expect(res.body.signals.some((s) => s.name === "data_structure_hash_map")).toBe(true);

      const savedSignals = await InterviewSignal.find({ sessionId: sessionDoc._id });
      expect(savedSignals.length).toBeGreaterThan(0);
    });

    it("should require authentication token", async () => {
      const res = await request(app).post("/api/signals/extract").send({
        sessionId: sessionDoc._id,
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/signals/session/:sessionId", () => {
    it("should retrieve stored signals for a session in order", async () => {
      await InterviewSignal.create([
        {
          sessionId: sessionDoc._id,
          category: "coding",
          name: "data_structure_hash_map",
          indicator: "positive",
          offsetMs: 5000,
        },
        {
          sessionId: sessionDoc._id,
          category: "execution",
          name: "test_suite_all_passed",
          indicator: "positive",
          offsetMs: 25000,
        },
      ]);

      const res = await request(app)
        .get(`/api/signals/session/${sessionDoc._id}`)
        .set("Authorization", `Bearer ${seekerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(2);
      expect(res.body.signals[0].offsetMs).toBe(5000);
      expect(res.body.signals[1].offsetMs).toBe(25000);
    });
  });

  describe("POST /api/signals/evaluate/:sessionId", () => {
    it("should synthesize session timeline and signals into 4-pillar scorecard", async () => {
      await TimelineEvent.create({
        session: sessionDoc._id,
        pipeline: "CODING",
        eventType: "code.edit",
        offsetMs: 10000,
        participant: seekerUser._id,
        participantRole: "seeker",
        payload: { file: "/solution.py", lineCount: 20 },
      });

      await InterviewSignal.create({
        sessionId: sessionDoc._id,
        category: "coding",
        name: "data_structure_hash_map",
        indicator: "positive",
        offsetMs: 10000,
      });

      const res = await request(app)
        .post(`/api/signals/evaluate/${sessionDoc._id}`)
        .set("Authorization", `Bearer ${recruiterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.evaluation).toBeDefined();
      expect(res.body.evaluation.competencies.length).toBe(4);
      expect(res.body.evaluation.schemaVersion).toBe("signals-engine/2026-08-v1");
      expect(res.body.evaluation.recommendedDecision).toBeDefined();
    });
  });
});
