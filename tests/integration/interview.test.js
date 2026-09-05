const request = require("supertest");
const app = require("../../src/app");
const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const { createTestUser, createTestJob, getAuthToken } = require("../utils/helpers");

describe("Phase 2: Interview Session Management & Scheduling Integration Tests", () => {
  let seeker, seekerToken;
  let recruiter, recruiterToken;
  let otherRecruiter, otherRecruiterToken;
  let testJob;
  let testApplication;

  beforeEach(async () => {
    // 1. Create candidate seeker
    seeker = await createTestUser({
      name: "Alice Candidate",
      email: `alice.${Date.now()}@example.com`,
      role: "seeker",
      resumeText: "Experienced Software Engineer skilled in Python, Algorithms, Distributed Systems.",
      skills: ["python", "algorithms", "distributed systems"],
      degree: "BTech Computer Science",
      cgpa: 9.1,
      collegeTier: "tier1",
    });
    seekerToken = getAuthToken(seeker);

    // 2. Create hiring recruiter
    recruiter = await createTestUser({
      name: "Bob Recruiter",
      email: `bob.${Date.now()}@example.com`,
      role: "recruiter",
    });
    recruiterToken = getAuthToken(recruiter);

    // 3. Create independent 3rd-party recruiter for multi-tenant / RBAC isolation tests
    otherRecruiter = await createTestUser({
      name: "Eve Unauthorized Recruiter",
      email: `eve.${Date.now()}@example.com`,
      role: "recruiter",
    });
    otherRecruiterToken = getAuthToken(otherRecruiter);

    // 4. Create Job
    testJob = await createTestJob(recruiter._id, {
      title: "Senior Backend Engineer",
      skills: ["python", "algorithms"],
      atsRequirements: { minCgpa: 7.5, minExperienceYears: 0 },
    });

    // 5. Create Application
    testApplication = await Application.create({
      job: testJob._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      status: "shortlisted",
      atsScore: 92,
    });
  });

  describe("POST /api/interviews/schedule", () => {
    it("should allow the hiring recruiter to schedule an interview session", async () => {
      const scheduledDate = new Date(Date.now() + 86400000).toISOString();
      const res = await request(app)
        .post("/api/interviews/schedule")
        .set("Authorization", `Bearer ${recruiterToken}`)
        .send({
          applicationId: testApplication._id,
          scheduledStart: scheduledDate,
          title: "Technical Round 1: Live Coding & System Design",
          allowedLanguages: ["python", "javascript", "cpp"],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.session).toBeDefined();
      expect(res.body.session.status).toBe("SCHEDULED");
      expect(res.body.session.stage).toBe("WAITING_ROOM");
      expect(res.body.session.roomKey).toMatch(/^room-[a-f0-9]{16}$/);
      expect(res.body.session.seeker.toString()).toBe(seeker._id.toString());
      expect(res.body.session.recruiter.toString()).toBe(recruiter._id.toString());
    });

    it("should reject candidate (seeker) from scheduling an interview", async () => {
      const res = await request(app)
        .post("/api/interviews/schedule")
        .set("Authorization", `Bearer ${seekerToken}`)
        .send({
          applicationId: testApplication._id,
          scheduledStart: new Date().toISOString(),
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.msg).toMatch(/Forbidden/);
    });

    it("should prevent unauthorized recruiters from scheduling an interview for another recruiter's applicant", async () => {
      const res = await request(app)
        .post("/api/interviews/schedule")
        .set("Authorization", `Bearer ${otherRecruiterToken}`)
        .send({
          applicationId: testApplication._id,
          scheduledStart: new Date().toISOString(),
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.msg).toMatch(/Only the hiring recruiter/);
    });
  });

  describe("GET /api/interviews/:sessionId & Role Tokens", () => {
    let session;

    beforeEach(async () => {
      session = await InterviewSession.create({
        application: testApplication._id,
        job: testJob._id,
        seeker: seeker._id,
        recruiter: recruiter._id,
        scheduledStart: new Date(),
        roomKey: `room-test-${Date.now()}`,
      });
    });

    it("should allow candidate to retrieve session and receive candidate permissions", async () => {
      const res = await request(app)
        .get(`/api/interviews/${session._id}`)
        .set("Authorization", `Bearer ${seekerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.session).toBeDefined();
      expect(res.body.role).toBe("seeker");
      expect(res.body.permissions.canControlStage).toBe(false);
      expect(res.body.permissions.canExecuteCode).toBe(true);
      expect(res.body.permissions.canGradeScorecard).toBe(false);
      expect(res.body.permissions.canViewAiAssistant).toBe(false);
      expect(res.body.roomToken).toBeDefined();
    });

    it("should allow recruiter to retrieve session and receive full control permissions", async () => {
      const res = await request(app)
        .get(`/api/interviews/${session._id}`)
        .set("Authorization", `Bearer ${recruiterToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.role).toBe("recruiter");
      expect(res.body.permissions.canControlStage).toBe(true);
      expect(res.body.permissions.canGradeScorecard).toBe(true);
      expect(res.body.permissions.canViewAiAssistant).toBe(true);
    });

    it("should block non-participants from accessing the interview session", async () => {
      const res = await request(app)
        .get(`/api/interviews/${session._id}`)
        .set("Authorization", `Bearer ${otherRecruiterToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.msg).toMatch(/Access denied/);
    });
  });

  describe("PATCH /api/interviews/:sessionId/stage", () => {
    let session;

    beforeEach(async () => {
      session = await InterviewSession.create({
        application: testApplication._id,
        job: testJob._id,
        seeker: seeker._id,
        recruiter: recruiter._id,
        scheduledStart: new Date(),
        roomKey: `room-stage-${Date.now()}`,
        status: "WAITING_ROOM",
      });
    });

    it("should allow recruiter to transition stages and update timeline", async () => {
      const res = await request(app)
        .patch(`/api/interviews/${session._id}/stage`)
        .set("Authorization", `Bearer ${recruiterToken}`)
        .send({ stage: "CODING", offsetMs: 12000 });

      expect(res.statusCode).toBe(200);
      expect(res.body.session.stage).toBe("CODING");
      expect(res.body.session.status).toBe("LIVE");
    });

    it("should forbid seeker from changing interview stages", async () => {
      const res = await request(app)
        .patch(`/api/interviews/${session._id}/stage`)
        .set("Authorization", `Bearer ${seekerToken}`)
        .send({ stage: "CODING" });

      expect(res.statusCode).toBe(403);
    });
  });
});
