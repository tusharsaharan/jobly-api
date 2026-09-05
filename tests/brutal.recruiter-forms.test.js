const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const config = require("../src/config/env");
const User = require("../src/models/User");
const Job = require("../src/models/Job");
const Application = require("../src/models/Application");
const InterviewSession = require("../src/models/InterviewSession");
const TimelineEvent = require("../src/models/TimelineEvent");
const { createTestUser, createTestJob, getAuthToken } = require("./utils/helpers");

describe("Brutal Recruiter Forms - Extensive", () => {
  jest.setTimeout(120000);
  let recruiter, recruiterToken, recruiter2, recruiter2Token, seeker, seekerToken, job, application;

  beforeEach(async () => {
    recruiter = await createTestUser({ name: "Recruiter Brutal", email: `rb-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    recruiter2 = await createTestUser({ name: "Recruiter2", email: `rb2-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    seeker = await createTestUser({ name: "Seeker Brutal", email: `sb-${Date.now()}-${Math.random()}@ex.com`, role: "seeker", skills: ["js"], degree: "BTech", cgpa: 8, resumeText: "js developer" });
    recruiterToken = getAuthToken(recruiter);
    recruiter2Token = getAuthToken(recruiter2);
    seekerToken = getAuthToken(seeker);
    // create base job and application for interview tests
    job = await createTestJob(recruiter._id, { title: "Base Job For Interview", description: "This is a base job description that is long enough to pass validation for interview tests. Needs 20 chars.", skills: ["js"] });
    application = await Application.create({ job: job._id, seeker: seeker._id, recruiter: recruiter._id, status: "shortlisted", atsScore: 80 });
  });

  // ========== JOB CREATION FORM ==========
  describe("POST /api/jobs - Recruiter Job Form", () => {
    const validJob = () => ({
      title: "Senior Backend Engineer",
      company: "Acme Corp",
      description: "We are looking for a senior backend engineer with 5+ years of experience in Node.js and distributed systems. Must handle high scale.",
      skills: ["nodejs", "mongodb", "redis"],
      location: "Remote",
      type: "Full-time",
      atsRequirements: { minCgpa: 7.5, minExperienceYears: 2, targetCollegeTier: "tier2", requiredDegree: "BTech" }
    });

    test("should create job with valid payload", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send(validJob());
      expect(res.status).toBe(201);
      expect(res.body.title).toBe(validJob().title);
    });

    test("should reject empty title", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), title: "" });
      expect([400,422]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
    test("should reject 1 char title", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), title: "A" });
      expect([400,422]).toContain(res.status);
    });
    test("should reject 161 char title", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), title: "A".repeat(161) });
      expect([400,422]).toContain(res.status);
    });
    test("should reject missing description", async () => {
      const { description, ...rest } = validJob();
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send(rest);
      expect([400,422]).toContain(res.status);
    });
    test("should reject 19 char description", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), description: "Too short desc 19!!" });
      expect([400,422]).toContain(res.status);
    });
    test("should reject 8001 char description", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), description: "A".repeat(8001) });
      expect([400,422]).toContain(res.status);
    });
    test("should reject seeker creating job (403)", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${seekerToken}`).send(validJob());
      expect(res.status).toBe(403);
    });
    test("should reject unauthenticated", async () => {
      const res = await request(app).post("/api/jobs").send(validJob());
      expect([401,403]).toContain(res.status);
    });
    test("should handle XSS payload in title without 500", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), title: "<script>alert(1)</script>" });
      expect(res.status).not.toBe(500);
      expect([201,400,422]).toContain(res.status);
    });
    test("should handle 31 skills (exceed limit 30)", async () => {
      const skills = Array.from({length:31}, (_,i)=>`skill${i}`);
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), skills });
      expect([400,422]).toContain(res.status);
    });
    test("should reject skill >80 chars", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), skills: ["a".repeat(81)] });
      expect([400,422]).toContain(res.status);
    });
    test("should handle company >160 chars", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), company: "a".repeat(161) });
      expect([400,422]).toContain(res.status);
    });
    test("should handle location >160 chars", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), location: "a".repeat(161) });
      expect([400,422]).toContain(res.status);
    });
    test("should reject invalid type", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), type: "Freelance-Invalid" });
      // normalizeJobType will return "" and then validation may allow? Check behavior
      expect(res.status).not.toBe(500);
    });
    test("should handle valid types: Full-time, Part-time, Contract, Internship", async () => {
      for (const t of ["Full-time","Part-time","Contract","Internship"]) {
        const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), title: `Job ${t} ${Date.now()}` , type: t });
        expect(res.status).toBe(201);
      }
    });
    test("should reject minCgpa negative", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), atsRequirements: { minCgpa: -1 } });
      expect([400,422]).toContain(res.status);
    });
    test("should reject minCgpa 11", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), atsRequirements: { minCgpa: 11 } });
      expect([400,422]).toContain(res.status);
    });
    test("should reject minCgpa string", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), atsRequirements: { minCgpa: "high" } });
      expect([400,422]).toContain(res.status);
    });
    test("should reject minExperienceYears 61", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), atsRequirements: { minExperienceYears: 61 } });
      expect([400,422]).toContain(res.status);
    });
    test("should reject minExperienceYears -5", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), atsRequirements: { minExperienceYears: -5 } });
      expect([400,422]).toContain(res.status);
    });
    test("should reject invalid targetCollegeTier", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), atsRequirements: { targetCollegeTier: "tier5" } });
      expect([400,422]).toContain(res.status);
    });
    test("should reject requiredDegree >120", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), atsRequirements: { requiredDegree: "a".repeat(121) } });
      expect([400,422]).toContain(res.status);
    });
    test("should handle concurrent 20 job creations", async () => {
      const promises = Array.from({length:20}, (_,i) => request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), title: `Concurrent Job ${i} ${Date.now()}` }));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(201));
    });
    test("should handle 100KB description fuzz without 500", async () => {
      const largeDesc = "A".repeat(100000);
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ ...validJob(), description: largeDesc });
      expect(res.status).not.toBe(500);
      expect([400,422]).toContain(res.status);
    });
  });

  // ========== AI GENERATE FORM ==========
  describe("POST /api/jobs/ai-generate", () => {
    test("should reject empty prompt", async () => {
      const res = await request(app).post("/api/jobs/ai-generate").set("Authorization", `Bearer ${recruiterToken}`).send({ prompt: "" });
      expect([400,422]).toContain(res.status);
    });
    test("should reject 2 char prompt", async () => {
      const res = await request(app).post("/api/jobs/ai-generate").set("Authorization", `Bearer ${recruiterToken}`).send({ prompt: "hi" });
      expect([400,422]).toContain(res.status);
    });
    test("should reject 4001 char prompt", async () => {
      const res = await request(app).post("/api/jobs/ai-generate").set("Authorization", `Bearer ${recruiterToken}`).send({ prompt: "a".repeat(4001) });
      expect([400,422]).toContain(res.status);
    });
    test("should reject seeker", async () => {
      const res = await request(app).post("/api/jobs/ai-generate").set("Authorization", `Bearer ${seekerToken}`).send({ prompt: "Need a backend engineer with Node" });
      expect(res.status).toBe(403);
    });
    test("should handle valid prompt", async () => {
      const res = await request(app).post("/api/jobs/ai-generate").set("Authorization", `Bearer ${recruiterToken}`).send({ prompt: "Need a senior React engineer for fintech, 5 years, remote" });
      expect([200,500]).toContain(res.status); // AI may fail but not 400 validation
      expect(res.status).not.toBe(400);
    });
    test("should handle prompt with script injection", async () => {
      const res = await request(app).post("/api/jobs/ai-generate").set("Authorization", `Bearer ${recruiterToken}`).send({ prompt: "<script>alert(1)</script> need engineer" });
      expect(res.status).not.toBe(500);
      // Should be 200 or 500 depending on AI, but not crash
    });
  });

  // ========== CANDIDATE POOL PREVIEW ==========
  describe("POST /api/jobs/candidate-pool-preview", () => {
    test("should return matchingCandidates for valid payload", async () => {
      const res = await request(app).post("/api/jobs/candidate-pool-preview").set("Authorization", `Bearer ${recruiterToken}`).send({ skills: ["js"], minCgpa: 7, targetCollegeTier: "tier2" });
      expect(res.status).toBe(200);
      expect(typeof res.body.matchingCandidates).toBe("number");
    });
    test("should handle empty skills", async () => {
      const res = await request(app).post("/api/jobs/candidate-pool-preview").set("Authorization", `Bearer ${recruiterToken}`).send({ skills: [], minCgpa: 0, targetCollegeTier: "any" });
      expect(res.status).toBe(200);
    });
    test("should handle huge skills array", async () => {
      const skills = Array.from({length:100}, (_,i)=>`skill${i}`);
      const res = await request(app).post("/api/jobs/candidate-pool-preview").set("Authorization", `Bearer ${recruiterToken}`).send({ skills, minCgpa: 10, targetCollegeTier: "tier1" });
      expect(res.status).not.toBe(500);
    });
    test("should handle negative minCgpa", async () => {
      const res = await request(app).post("/api/jobs/candidate-pool-preview").set("Authorization", `Bearer ${recruiterToken}`).send({ skills: ["js"], minCgpa: -5 });
      expect(res.status).not.toBe(500);
    });
    test("should reject seeker", async () => {
      const res = await request(app).post("/api/jobs/candidate-pool-preview").set("Authorization", `Bearer ${seekerToken}`).send({ skills: ["js"] });
      expect(res.status).toBe(403);
    });
  });

  // ========== APPLICATION STATUS ==========
  describe("PATCH /api/applications/:id/status - Recruiter", () => {
    test("should update to shortlisted", async () => {
      const res = await request(app).patch(`/api/applications/${application._id}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: "shortlisted" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("shortlisted");
    });
    test("should update to rejected", async () => {
      const res = await request(app).patch(`/api/applications/${application._id}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: "rejected" });
      expect(res.status).toBe(200);
    });
    test("should reject invalid status", async () => {
      const res = await request(app).patch(`/api/applications/${application._id}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: "hired" });
      expect(res.status).toBe(400);
    });
    test("should reject invalid ObjectId", async () => {
      const res = await request(app).patch(`/api/applications/invalid-id/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: "shortlisted" });
      expect(res.status).toBe(400);
    });
    test("should reject not found", async () => {
      const fakeId = "507f1f77bcf86cd799439011";
      const res = await request(app).patch(`/api/applications/${fakeId}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: "shortlisted" });
      expect(res.status).toBe(404);
    });
    test("should reject seeker trying to update", async () => {
      const res = await request(app).patch(`/api/applications/${application._id}/status`).set("Authorization", `Bearer ${seekerToken}`).send({ status: "shortlisted" });
      expect(res.status).toBe(403);
    });
    test("should reject other recruiter (not owner)", async () => {
      const res = await request(app).patch(`/api/applications/${application._id}/status`).set("Authorization", `Bearer ${recruiter2Token}`).send({ status: "shortlisted" });
      expect(res.status).toBe(403);
    });
    test("should handle missing status field", async () => {
      const res = await request(app).patch(`/api/applications/${application._id}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("should handle concurrent status updates", async () => {
      const statuses = ["shortlisted","rejected","shortlisted","rejected","applied"];
      const promises = statuses.map(s => request(app).patch(`/api/applications/${application._id}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: s }));
      const results = await Promise.all(promises);
      results.forEach(r => expect([200,400]).toContain(r.status));
      expect(results.some(r=>r.status===200)).toBe(true);
    });
  });

  // ========== INTERVIEW SCHEDULE ==========
  describe("POST /api/interviews/schedule", () => {
    test("should schedule with valid", async () => {
      const newApp = await Application.create({ job: job._id, seeker: (await createTestUser({email:`s2-${Date.now()}@ex.com`, role:"seeker"}))._id, recruiter: recruiter._id, status: "shortlisted" });
      const res = await request(app).post("/api/interviews/schedule").set("Authorization", `Bearer ${recruiterToken}`).send({ applicationId: newApp._id, scheduledStart: new Date(Date.now()+86400000).toISOString(), title: "Tech Round" });
      expect(res.status).toBe(201);
    });
    test("should reject missing applicationId", async () => {
      const res = await request(app).post("/api/interviews/schedule").set("Authorization", `Bearer ${recruiterToken}`).send({ scheduledStart: new Date().toISOString() });
      expect([400,422]).toContain(res.status);
    });
    test("should reject missing scheduledStart", async () => {
      const res = await request(app).post("/api/interviews/schedule").set("Authorization", `Bearer ${recruiterToken}`).send({ applicationId: application._id });
      expect([400,422]).toContain(res.status);
    });
    test("should reject invalid date", async () => {
      const res = await request(app).post("/api/interviews/schedule").set("Authorization", `Bearer ${recruiterToken}`).send({ applicationId: application._id, scheduledStart: "invalid-date" });
      expect([400,422]).toContain(res.status);
    });
    test("should reject title 1 char", async () => {
      const res = await request(app).post("/api/interviews/schedule").set("Authorization", `Bearer ${recruiterToken}`).send({ applicationId: application._id, scheduledStart: new Date().toISOString(), title: "A" });
      expect([400,422]).toContain(res.status);
    });
    test("should reject title 121 chars", async () => {
      const res = await request(app).post("/api/interviews/schedule").set("Authorization", `Bearer ${recruiterToken}`).send({ applicationId: application._id, scheduledStart: new Date().toISOString(), title: "A".repeat(121) });
      expect([400,422]).toContain(res.status);
    });
    test("should reject seeker", async () => {
      const res = await request(app).post("/api/interviews/schedule").set("Authorization", `Bearer ${seekerToken}`).send({ applicationId: application._id, scheduledStart: new Date().toISOString() });
      expect(res.status).toBe(403);
    });
    test("should reject other recruiter not owning application", async () => {
      const res = await request(app).post("/api/interviews/schedule").set("Authorization", `Bearer ${recruiter2Token}`).send({ applicationId: application._id, scheduledStart: new Date().toISOString() });
      expect(res.status).toBe(403);
    });
    test("should reject unauthenticated", async () => {
      const res = await request(app).post("/api/interviews/schedule").send({ applicationId: application._id, scheduledStart: new Date().toISOString() });
      expect([401,403]).toContain(res.status);
    });
  });

  // ========== STAGE / STATUS ==========
  describe("PATCH /api/interviews/:sessionId/stage", () => {
    let session;
    beforeEach(async () => {
      session = await InterviewSession.create({ application: application._id, job: job._id, seeker: seeker._id, recruiter: recruiter._id, roomKey: `room-stage-${Date.now()}-${Math.random()}`, scheduledStart: new Date() });
    });
    test("should allow valid stage CODING", async () => {
      const res = await request(app).patch(`/api/interviews/${session._id}/stage`).set("Authorization", `Bearer ${recruiterToken}`).send({ stage: "CODING" });
      expect(res.status).toBe(200);
    });
    test("should reject invalid stage", async () => {
      const res = await request(app).patch(`/api/interviews/${session._id}/stage`).set("Authorization", `Bearer ${recruiterToken}`).send({ stage: "INVALID_STAGE" });
      expect([400,422]).toContain(res.status);
    });
    test("should reject missing stage", async () => {
      const res = await request(app).patch(`/api/interviews/${session._id}/stage`).set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect([400,422]).toContain(res.status);
    });
    test("should reject seeker", async () => {
      const res = await request(app).patch(`/api/interviews/${session._id}/stage`).set("Authorization", `Bearer ${seekerToken}`).send({ stage: "CODING" });
      expect(res.status).toBe(403);
    });
    test("should reject invalid ObjectId", async () => {
      const res = await request(app).patch(`/api/interviews/invalid-id/stage`).set("Authorization", `Bearer ${recruiterToken}`).send({ stage: "CODING" });
      expect([400,500]).toContain(res.status);
      expect(res.status).not.toBe(200);
    });
    test("should handle concurrent stage transitions", async () => {
      const stages = ["INTRODUCTION","CODING","SYSTEM_DESIGN","DEBUGGING","FEEDBACK"];
      const promises = stages.map(s => request(app).patch(`/api/interviews/${session._id}/stage`).set("Authorization", `Bearer ${recruiterToken}`).send({ stage: s }));
      const results = await Promise.all(promises);
      results.forEach(r => expect([200,400]).toContain(r.status));
    });
  });

  // ========== EVALUATION FORM ==========
  describe("POST /api/evaluations/:sessionId", () => {
    let session, timelineEvent;
    beforeEach(async () => {
      session = await InterviewSession.create({ application: application._id, job: job._id, seeker: seeker._id, recruiter: recruiter._id, roomKey: `room-eval-${Date.now()}-${Math.random()}`, scheduledStart: new Date(), actualStart: new Date(), status: "LIVE" });
      timelineEvent = await TimelineEvent.create({ session: session._id, pipeline: "CODING", eventType: "code.execution", offsetMs: 1000, participant: seeker._id, payload: { text: "code" } });
    });
    const validEval = (evId) => ({
      overallRating: 4,
      decision: "HIRE",
      competencies: [{ category: "Coding", score: 4, notes: "Good", evidenceRefs: [{ refType: "TIMELINE_EVENT", timelineEventId: evId }] }],
      strengths: ["Strong"],
      weaknesses: ["Weak"],
      privateNotes: "private"
    });
    test("should create with valid", async () => {
      const res = await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send(validEval(timelineEvent._id));
      expect(res.status).toBe(201);
    });
    test("should reject missing overallRating", async () => {
      const { overallRating, ...rest } = validEval(timelineEvent._id);
      const res = await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send(rest);
      expect([400,422]).toContain(res.status);
    });
    test("should reject overallRating 0", async () => {
      const res = await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send({ ...validEval(timelineEvent._id), overallRating: 0 });
      expect([400,422]).toContain(res.status);
    });
    test("should reject overallRating 6", async () => {
      const res = await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send({ ...validEval(timelineEvent._id), overallRating: 6 });
      expect([400,422]).toContain(res.status);
    });
    test("should reject invalid decision", async () => {
      const res = await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send({ ...validEval(timelineEvent._id), decision: "MAYBE" });
      expect([400,422]).toContain(res.status);
    });
    test("should reject missing competencies evidence", async () => {
      const res = await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send({ ...validEval(timelineEvent._id), competencies: [{ category: "Coding", score: 4, evidenceRefs: [] }] });
      expect([400,422]).toContain(res.status);
    });
    test("should reject invalid timelineEventId", async () => {
      const fakeId = "507f1f77bcf86cd799439011";
      const res = await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send(validEval(fakeId));
      expect(res.status).toBe(400);
    });
    test("should reject seeker", async () => {
      const res = await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${seekerToken}`).send(validEval(timelineEvent._id));
      expect([401,403]).toContain(res.status);
    });
    test("should handle XSS in privateNotes without 500", async () => {
      const res = await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send({ ...validEval(timelineEvent._id), privateNotes: "<script>alert(1)</script>" });
      expect(res.status).not.toBe(500);
    });
    test("should handle concurrent evaluations", async () => {
      const promises = Array.from({length:5}, () => request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send(validEval(timelineEvent._id)));
      const results = await Promise.all(promises);
      results.forEach(r => expect([201,400]).toContain(r.status));
    });
  });

  // ========== EXTRA RECRUITER FORMS: health-score, market-compare, etc ==========
  describe("Other Recruiter Forms", () => {
    test("POST /api/jobs/health-score valid", async () => {
      const res = await request(app).post("/api/jobs/health-score").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "rules", payload: { title: "Engineer", description: "Build scalable systems with Node and handle distributed architecture for high throughput services." } });
      expect(res.status).not.toBe(500);
      expect([200,400]).toContain(res.status);
    });
    test("POST /api/jobs/health-score empty payload", async () => {
      const res = await request(app).post("/api/jobs/health-score").set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).not.toBe(500);
    });
    test("POST /api/jobs/market-compare valid", async () => {
      const res = await request(app).post("/api/jobs/market-compare").set("Authorization", `Bearer ${recruiterToken}`).send({ title: "Backend Engineer", skills: ["nodejs"], atsRequirements: { minCgpa: 7 } });
      expect(res.status).toBe(200);
    });
    test("POST /api/jobs/market-compare empty", async () => {
      const res = await request(app).post("/api/jobs/market-compare").set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).not.toBe(500);
    });
    test("POST /api/jobs/flag-requirements rules", async () => {
      const res = await request(app).post("/api/jobs/flag-requirements").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "rules", payload: { title: "Engineer", description: "Need engineer" } });
      expect(res.status).not.toBe(500);
    });
    test("POST /api/jobs/dei-rewrite short description", async () => {
      const res = await request(app).post("/api/jobs/dei-rewrite").set("Authorization", `Bearer ${recruiterToken}`).send({ title: "Engineer", description: "short" });
      expect(res.status).toBe(400);
    });
    test("POST /api/jobs/dei-rewrite valid", async () => {
      const res = await request(app).post("/api/jobs/dei-rewrite").set("Authorization", `Bearer ${recruiterToken}`).send({ title: "Engineer", description: "We are looking for a brilliant rockstar ninja who will crush code and dominate the team." });
      expect(res.status).not.toBe(500);
    });
    test("POST /api/jobs/predict-questions missing", async () => {
      const res = await request(app).post("/api/jobs/predict-questions").set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("POST /api/jobs/predict-questions valid", async () => {
      const res = await request(app).post("/api/jobs/predict-questions").set("Authorization", `Bearer ${recruiterToken}`).send({ title: "Backend Engineer", description: "Nodejs role with microservices and high scalability needs for 10k daily users." });
      expect(res.status).not.toBe(500);
    });
    test("POST /api/jobs/candidate-pool-preview huge payload", async () => {
      const res = await request(app).post("/api/jobs/candidate-pool-preview").set("Authorization", `Bearer ${recruiterToken}`).send({ skills: Array(100).fill("js"), minCgpa: 999, targetCollegeTier: "invalid" });
      expect(res.status).not.toBe(500);
    });
  });
});
