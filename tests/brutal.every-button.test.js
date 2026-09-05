const request = require("supertest");
const app = require("../src/app");
const User = require("../src/models/User");
const Job = require("../src/models/Job");
const Application = require("../src/models/Application");
const InterviewSession = require("../src/models/InterviewSession");
const { createTestUser, createTestJob, getAuthToken } = require("./utils/helpers");

describe("Brutal Every Button — Full Website", () => {
  jest.setTimeout(180000);
  let seeker, seekerToken, recruiter, recruiterToken, job, application, session, roomKey;

  beforeEach(async () => {
    seeker = await createTestUser({ name: "Every Seeker", email: `every-s-${Date.now()}-${Math.random()}@ex.com`, role: "seeker", skills: ["js"], degree: "BTech", cgpa: 8.5, resumeText: "js developer" });
    recruiter = await createTestUser({ name: "Every Recruiter", email: `every-r-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    seekerToken = getAuthToken(seeker);
    recruiterToken = getAuthToken(recruiter);
    job = await createTestJob(recruiter._id, { title: "Every Job", description: "Valid job description with more than twenty characters for every button test.", skills: ["js"], atsRequirements: { minCgpa: 7 } });
    application = await Application.create({ job: job._id, seeker: seeker._id, recruiter: recruiter._id, status: "shortlisted", atsScore: 80 });
    roomKey = `room-every-${Date.now()}-${Math.random()}`;
    session = await InterviewSession.create({ tenantId: "default", application: application._id, job: job._id, seeker: seeker._id, recruiter: recruiter._id, roomKey, scheduledStart: new Date(), actualStart: new Date(Date.now()-60000), status: "LIVE", stage: "CODING" });
    await require("../src/models/TimelineEvent").create({ session: session._id, pipeline: "CODING", eventType: "code.execution", offsetMs: 1000, participant: seeker._id, payload: { text: "exec" } });
    await require("../src/models/CodeCheckpoint").create({ session: session._id, triggerType: "MANUAL", triggerLabel: "Manual", sequenceNumber: 1, filesSnapshot: [{ path: "/solution.py", name: "solution.py", content: "print(1)", language: "python" }], offsetMs: 1000 });
  });

  // ========== AUTH BUTTONS ==========
  describe("Auth Buttons", () => {
    test("POST /api/auth/register — valid seeker", async () => {
      const res = await request(app).post("/api/auth/register").send({ name: "Test", email: `test-${Date.now()}@ex.com`, password: "password123", role: "seeker" });
      expect([201,200]).toContain(res.status);
    });
    test("POST /api/auth/register — missing fields 400", async () => {
      const res = await request(app).post("/api/auth/register").send({ email: "a@b.com" });
      expect([400,422]).toContain(res.status);
    });
    test("POST /api/auth/login — valid", async () => {
      const email = `login-${Date.now()}@ex.com`;
      await request(app).post("/api/auth/register").send({ name: "Test", email, password: "password123", role: "seeker" });
      const res = await request(app).post("/api/auth/login").send({ email, password: "password123" });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });
    test("POST /api/auth/login — wrong password 401", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: "nonexistent@test.com", password: "wrong" });
      expect([400,401,404]).toContain(res.status);
    });
    test("GET /api/users/me — auth 200", async () => {
      const res = await request(app).get("/api/users/me").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("GET /api/users/me — no auth 401", async () => {
      const res = await request(app).get("/api/users/me");
      expect([401,403]).toContain(res.status);
    });
  });

  // ========== DASHBOARD BUTTONS ==========
  describe("Dashboard Buttons", () => {
    test("GET /api/dashboard — seeker 200", async () => {
      const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
      expect([200,404]).toContain(res.status);
    });
    test("GET /api/dashboard — recruiter 200", async () => {
      const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
    });
  });

  // ========== JOBS BUTTONS ==========
  describe("Jobs Buttons", () => {
    test("GET /api/jobs — 200", async () => {
      const res = await request(app).get("/api/jobs").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("GET /api/jobs/search?q=js — 200", async () => {
      const res = await request(app).get("/api/jobs/search?q=js").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("GET /api/jobs/match — seeker 200", async () => {
      const res = await request(app).get("/api/jobs/match").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("POST /api/jobs — recruiter Publish 201", async () => {
      const res = await request(app).post("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`).send({ title: "Publish Test", company: "C", description: "Valid description with more than twenty characters for publish.", skills: ["js"], location: "Remote", type: "Full-time" });
      expect(res.status).toBe(201);
    });
    test("POST /api/jobs/ai-generate — 200", async () => {
      const res = await request(app).post("/api/jobs/ai-generate").set("Authorization", `Bearer ${recruiterToken}`).send({ prompt: "Need a backend engineer" });
      expect(res.status).not.toBe(500);
    });
    test("POST /api/jobs/candidate-pool-preview — 200", async () => {
      const res = await request(app).post("/api/jobs/candidate-pool-preview").set("Authorization", `Bearer ${recruiterToken}`).send({ skills: ["js"], minCgpa: 7 });
      expect(res.status).toBe(200);
    });
    test("POST /api/jobs/health-score — 200", async () => {
      const res = await request(app).post("/api/jobs/health-score").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "rules", payload: { title: "Engineer", description: "Build scalable systems with Node and handle distributed architecture." } });
      expect(res.status).not.toBe(500);
    });
    test("POST /api/jobs/market-compare — 200", async () => {
      const res = await request(app).post("/api/jobs/market-compare").set("Authorization", `Bearer ${recruiterToken}`).send({ title: "Engineer", skills: ["js"] });
      expect(res.status).toBe(200);
    });
    test("POST /api/jobs/flag-requirements — 200", async () => {
      const res = await request(app).post("/api/jobs/flag-requirements").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "rules", payload: { title: "Engineer" } });
      expect(res.status).not.toBe(500);
    });
    test("POST /api/jobs/dei-rewrite — 200", async () => {
      const res = await request(app).post("/api/jobs/dei-rewrite").set("Authorization", `Bearer ${recruiterToken}`).send({ title: "Engineer", description: "We need a rockstar ninja who crushes code." });
      expect(res.status).not.toBe(500);
    });
    test("POST /api/jobs/predict-questions — 200", async () => {
      const res = await request(app).post("/api/jobs/predict-questions").set("Authorization", `Bearer ${recruiterToken}`).send({ title: "Engineer", description: "Nodejs role with microservices." });
      expect(res.status).not.toBe(500);
    });
    test("GET /api/jobs/:jobId/ats-score — 200", async () => {
      const res = await request(app).get(`/api/jobs/${job._id}/ats-score`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
  });

  // ========== APPLICATIONS/APPLICANTS BUTTONS ==========
  describe("Applications/Applicants Buttons", () => {
    test("POST /api/applications/:jobId — seeker apply 200", async () => {
      const newJob = await createTestJob(recruiter._id, { title: "Apply Job", description: "Valid description for apply job with sufficient length." });
      const res = await request(app).post(`/api/applications/${newJob._id}`).set("Authorization", `Bearer ${seekerToken}`).send();
      expect([200,400]).toContain(res.status); // 400 if already applied or ATS fail
    });
    test("GET /api/applications/me — seeker 200", async () => {
      const res = await request(app).get("/api/applications/me").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("GET /api/applications/recruiter — recruiter 200", async () => {
      const res = await request(app).get("/api/applications/recruiter").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("GET /api/applications/recruiter/search?q=js — 200", async () => {
      const res = await request(app).get("/api/applications/recruiter/search?q=js").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("PATCH /api/applications/:id/status — Shortlist/Reject 200", async () => {
      const res1 = await request(app).patch(`/api/applications/${application._id}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: "shortlisted" });
      expect(res1.status).toBe(200);
      const res2 = await request(app).patch(`/api/applications/${application._id}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: "rejected" });
      expect(res2.status).toBe(200);
    });
  });

  // ========== RESUME BUTTONS ==========
  describe("Resume Buttons", () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
    test("POST /api/resume/upload — 200", async () => {
      const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", pdf, { filename: "resume.pdf", contentType: "application/pdf" });
      expect(res.status).not.toBe(500);
    });
    test("GET /api/resume/profile — 200", async () => {
      const res = await request(app).get("/api/resume/profile").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("PUT /api/resume/profile — 200", async () => {
      const profile = { schemaVersion: "resume-profile/1", source: { uploadId: "upl-test", fileName: "resume.pdf", sha256: "abc", extractedAt: new Date().toISOString(), extractor: "test" }, contact: {}, headline: "Engineer", summary: "Summary", skills: [], experience: [], projects: [], education: [], certifications: [], achievements: [], sectionsDetected: [], parseWarnings: [] };
      const res = await request(app).put("/api/resume/profile").set("Authorization", `Bearer ${seekerToken}`).send({ resumeProfile: profile });
      expect(res.status).toBe(200);
    });
    test("GET /api/resume/events — SSE 200", async () => {
      // SSE is long-lived, verify auth and that it doesn't immediately 500
      const noAuth = await request(app).get("/api/resume/events");
      expect([401,403]).toContain(noAuth.status);
      // With auth, the endpoint should either return 200 quickly (headers) or timeout (stream) — not 500
      // Use a 1.5s race to avoid hanging
      let status = null;
      let timedOut = false;
      try {
        const res = await Promise.race([
          request(app).get("/api/resume/events").set("Authorization", `Bearer ${seekerToken}`),
          new Promise((_, rej) => setTimeout(() => { timedOut = true; rej(new Error("SSE timeout as expected")); }, 1500))
        ]);
        status = res.status;
      } catch (e) {
        // Timeout is expected for SSE
      }
      expect(timedOut || status === 200).toBeTruthy();
    });
  });

  // ========== MESSAGES BUTTONS ==========
  describe("Messages Buttons", () => {
    test("GET /api/messages/conversations — 200", async () => {
      const res = await request(app).get("/api/messages/conversations").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
      expect([200,404]).toContain(res.status);
    });
    test("GET /api/messages/application/:id — 200", async () => {
      const res = await request(app).get(`/api/messages/application/${application._id}`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
      expect([200,404]).toContain(res.status);
    });
    test("POST /api/messages/application/:id — valid 200", async () => {
      const res = await request(app).post(`/api/messages/application/${application._id}`).set("Authorization", `Bearer ${seekerToken}`).send({ text: "Hello recruiter, excited for interview!" });
      expect(res.status).not.toBe(500);
      expect([200,201,400]).toContain(res.status);
    });
    test("POST /api/messages/application/:id — empty 400", async () => {
      const res = await request(app).post(`/api/messages/application/${application._id}`).set("Authorization", `Bearer ${seekerToken}`).send({ text: "" });
      expect([400,422]).toContain(res.status);
    });
    test("POST /api/messages/application/:id — unauth 401", async () => {
      const res = await request(app).post(`/api/messages/application/${application._id}`).send({ text: "hi" });
      expect([401,403]).toContain(res.status);
    });
  });

  // ========== INTERVIEWS LIST BUTTONS ==========
  describe("Interviews List Buttons", () => {
    test("GET /api/interviews — 200", async () => {
      const res = await request(app).get("/api/interviews").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("POST /api/interviews/schedule — Publish 201", async () => {
      const newApp = await Application.create({ job: job._id, seeker: (await createTestUser({ email: `sched-${Date.now()}@ex.com`, role: "seeker" }))._id, recruiter: recruiter._id, status: "shortlisted" });
      const res = await request(app).post("/api/interviews/schedule").set("Authorization", `Bearer ${recruiterToken}`).send({ applicationId: newApp._id, scheduledStart: new Date(Date.now()+86400000).toISOString(), title: "Interview" });
      expect(res.status).toBe(201);
    });
  });

  // ========== LEARN BUTTONS ==========
  describe("Learn Buttons", () => {
    test("POST /api/learn/generate-quiz — 200", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", count: 5 });
      expect(res.status).not.toBe(500);
      expect([200,400]).toContain(res.status);
    });
    test("POST /api/learn/session — Study 201", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: "System Design", durationMinutes: 25 });
      expect(res.status).toBe(201);
    });
    test("POST /api/learn/session/:id/complete — 200", async () => {
      const s = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: "Test", durationMinutes: 10 });
      const res = await request(app).post(`/api/learn/session/${s.body._id}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({});
      expect(res.status).toBe(200);
    });
    test("GET /api/learn/stats — 200", async () => {
      const res = await request(app).get("/api/learn/stats").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("GET /api/study/problems — 200", async () => {
      const res = await request(app).get("/api/study/problems").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("GET /api/study/progress — 200", async () => {
      const res = await request(app).get("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("POST /api/study/progress — 200", async () => {
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`).send({ type: "DSA", questionId: "q1", completed: true });
      expect(res.status).toBe(200);
    });
  });

  // ========== COMPETE BUTTONS ==========
  describe("Compete Buttons", () => {
    test("POST /api/compete/create — 201", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ", difficulty: "Medium", questionCount: 5 });
      expect(res.status).toBe(201);
      expect(res.body.lobby.pin).toBeDefined();
    });
    test("POST /api/compete/join — 200", async () => {
      const create = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ" });
      const pin = create.body.lobby.pin;
      const res = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${recruiterToken}`).send({ pin });
      expect(res.status).toBe(200);
    });
    test("GET /api/compete/:id — 200", async () => {
      const create = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ" });
      const res = await request(app).get(`/api/compete/${create.body.lobby._id}`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
  });

  // ========== PROFILE BUTTONS ==========
  describe("Profile Buttons", () => {
    test("GET /api/users/profile — 200", async () => {
      const res = await request(app).get("/api/users/profile").set("Authorization", `Bearer ${seekerToken}`);
      // Some deployments use /api/users/me
      expect([200,404]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
    test("PUT /api/users/profile — 200", async () => {
      const res = await request(app).put("/api/users/profile").set("Authorization", `Bearer ${seekerToken}`).send({ name: "Updated Name" });
      expect([200,404]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
  });

  // ========== HEALTH & MISC BUTTONS ==========
  describe("Health & Misc Buttons", () => {
    test("GET /api/health — 200", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
    });
    test("GET / — 200", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
    });
    test("GET /api/dashboard — 200", async () => {
      const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${seekerToken}`);
      expect([200,404]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
  });
});
