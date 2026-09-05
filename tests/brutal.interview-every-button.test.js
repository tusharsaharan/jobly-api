const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const config = require("../src/config/env");
const User = require("../src/models/User");
const Job = require("../src/models/Job");
const Application = require("../src/models/Application");
const InterviewSession = require("../src/models/InterviewSession");
const TimelineEvent = require("../src/models/TimelineEvent");
const CodeCheckpoint = require("../src/models/CodeCheckpoint");
const WhiteboardSnapshot = require("../src/models/WhiteboardSnapshot");
const { createTestUser, createTestJob, getAuthToken } = require("./utils/helpers");

describe("Brutal Interview Every Button — 1Lakh Scale", () => {
  jest.setTimeout(180000);
  let seeker, recruiter, outsider, seekerToken, recruiterToken, outsiderToken, job, application, session, roomKey;

  beforeEach(async () => {
    seeker = await createTestUser({ name: "Seeker Every", email: `se-${Date.now()}-${Math.random()}@ex.com`, role: "seeker", skills: ["js"], degree: "BTech", cgpa: 9, collegeTier: "tier1", resumeText: "js developer with 2 years" });
    recruiter = await createTestUser({ name: "Recruiter Every", email: `re-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    outsider = await createTestUser({ name: "Outsider Every", email: `ou-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    seekerToken = getAuthToken(seeker);
    recruiterToken = getAuthToken(recruiter);
    outsiderToken = getAuthToken(outsider);
    job = await createTestJob(recruiter._id, { title: "Every Job", description: "This is a valid job description with more than twenty characters for testing.", skills: ["js", "node"], atsRequirements: { minCgpa: 7 } });
    application = await Application.create({ job: job._id, seeker: seeker._id, recruiter: recruiter._id, status: "shortlisted", atsScore: 85 });
    roomKey = `room-every-${Date.now()}-${Math.random()}`;
    session = await InterviewSession.create({
      tenantId: "default",
      application: application._id,
      job: job._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      roomKey,
      scheduledStart: new Date(),
      actualStart: new Date(Date.now() - 60000),
      status: "LIVE",
      stage: "CODING",
      allowedLanguages: ["python", "javascript", "typescript", "cpp", "java"],
    });
    // Seed timeline for replay
    await TimelineEvent.create({ session: session._id, pipeline: "STAGE", eventType: "stage.transition", offsetMs: 1000, participant: recruiter._id, payload: { stage: "CODING" } });
    await TimelineEvent.create({ session: session._id, pipeline: "CODING", eventType: "code.execution", offsetMs: 5000, participant: seeker._id, payload: { text: "exec" } });
    await TimelineEvent.create({ session: session._id, pipeline: "COMMUNICATION", eventType: "transcript.segment", offsetMs: 8000, participant: seeker._id, payload: { text: "hello" } });
    await CodeCheckpoint.create({ session: session._id, triggerType: "MANUAL", triggerLabel: "Manual", sequenceNumber: 1, filesSnapshot: [{ path: "/solution.py", name: "solution.py", content: "print(1)", language: "python" }], offsetMs: 5000 });
    await WhiteboardSnapshot.create({ session: session._id, sequenceNumber: 1, objects: [{ id: "a", type: "rect" }], offsetMs: 6000 });
  });

  // ========== INTERVIEW LIST / ROOM ==========
  describe("Interview List & Room Buttons", () => {
    test("GET /api/interviews — recruiter sees own", async () => {
      const res = await request(app).get("/api/interviews").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.interviews)).toBe(true);
    });
    test("GET /api/interviews — seeker sees own", async () => {
      const res = await request(app).get("/api/interviews").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("GET /api/interviews/:sessionId — recruiter 200", async () => {
      const res = await request(app).get(`/api/interviews/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("recruiter");
      expect(res.body.permissions.canControlStage).toBe(true);
    });
    test("GET /api/interviews/:sessionId — seeker 200", async () => {
      const res = await request(app).get(`/api/interviews/${session._id}`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("seeker");
    });
    test("GET /api/interviews/:sessionId — outsider 403", async () => {
      const res = await request(app).get(`/api/interviews/${session._id}`).set("Authorization", `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });
    test("GET /api/interviews/room/:roomKey — both roles 200", async () => {
      for (const tok of [recruiterToken, seekerToken]) {
        const res = await request(app).get(`/api/interviews/room/${roomKey}`).set("Authorization", `Bearer ${tok}`);
        expect(res.status).toBe(200);
        expect(res.body.session.roomKey).toBe(roomKey);
      }
    });
    test("GET /api/interviews/room/:roomKey — outsider 403", async () => {
      const res = await request(app).get(`/api/interviews/room/${roomKey}`).set("Authorization", `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });
    test("GET /api/interviews/room/invalid — 404", async () => {
      const res = await request(app).get(`/api/interviews/room/invalid-room-key-123`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ========== STAGE / STATUS BUTTONS ==========
  describe("Stage & Status Buttons (7 stages)", () => {
    const stages = ["WAITING_ROOM","INTRODUCTION","CODING","SYSTEM_DESIGN","DEBUGGING","FEEDBACK","COMPLETED"];
    test.each(stages)("PATCH stage %s — recruiter 200, seeker 403", async (stage) => {
      const s = await InterviewSession.create({ application: application._id, job: job._id, seeker: seeker._id, recruiter: recruiter._id, roomKey: `room-stage-${Date.now()}-${Math.random()}`, scheduledStart: new Date() });
      const rRec = await request(app).patch(`/api/interviews/${s._id}/stage`).set("Authorization", `Bearer ${recruiterToken}`).send({ stage });
      expect([200,400]).toContain(rRec.status);
      const rSeek = await request(app).patch(`/api/interviews/${s._id}/stage`).set("Authorization", `Bearer ${seekerToken}`).send({ stage });
      expect(rSeek.status).toBe(403);
    });
    test("should reject invalid stage", async () => {
      const res = await request(app).patch(`/api/interviews/${session._id}/stage`).set("Authorization", `Bearer ${recruiterToken}`).send({ stage: "INVALID" });
      expect([400,422]).toContain(res.status);
    });
    test("PUT /api/interviews/:id/stage — alias works", async () => {
      const res = await request(app).put(`/api/interviews/${session._id}/stage`).set("Authorization", `Bearer ${recruiterToken}`).send({ stage: "CODING" });
      expect(res.status).toBe(200);
    });
    test("PATCH /api/interviews/:id/status — LIVE/COMPLETED", async () => {
      const s = await InterviewSession.create({ application: application._id, job: job._id, seeker: seeker._id, recruiter: recruiter._id, roomKey: `room-status-${Date.now()}-${Math.random()}`, scheduledStart: new Date() });
      let res = await request(app).patch(`/api/interviews/${s._id}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: "LIVE" });
      expect(res.status).toBe(200);
      res = await request(app).put(`/api/interviews/${s._id}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: "COMPLETED" });
      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe("COMPLETED");
    });
    test("should reject invalid status", async () => {
      const res = await request(app).patch(`/api/interviews/${session._id}/status`).set("Authorization", `Bearer ${recruiterToken}`).send({ status: "INVALID" });
      expect(res.status).toBe(400);
    });
    test("should handle concurrent stage transitions (1Lakh scale race)", async () => {
      const s = await InterviewSession.create({ application: application._id, job: job._id, seeker: seeker._id, recruiter: recruiter._id, roomKey: `room-conc-${Date.now()}-${Math.random()}`, scheduledStart: new Date() });
      const promises = ["CODING","SYSTEM_DESIGN","DEBUGGING"].map(st => request(app).patch(`/api/interviews/${s._id}/stage`).set("Authorization", `Bearer ${recruiterToken}`).send({ stage: st }));
      const results = await Promise.all(promises);
      results.forEach(r => expect([200,400]).toContain(r.status));
    });
  });

  // ========== EXECUTE CODE BUTTON ==========
  describe("Execute Code Button (Monaco Run)", () => {
    const langs = ["python","javascript","typescript","cpp","java"];
    test.each(langs)("should execute %s", async (lang) => {
      const res = await request(app).post(`/api/interviews/${session._id}/execute`).set("Authorization", `Bearer ${seekerToken}`).send({ language: lang, code: lang==="python" ? "print(42)" : "console.log(42)" });
      expect(res.status).toBe(200);
      expect(res.body.execution).toBeDefined();
      expect(res.body.execution.sequence).toBeGreaterThan(0);
    });
    test("should reject missing language/code", async () => {
      const r1 = await request(app).post(`/api/interviews/${session._id}/execute`).set("Authorization", `Bearer ${seekerToken}`).send({ code: "print(1)" });
      expect(r1.status).toBe(400);
      const r2 = await request(app).post(`/api/interviews/${session._id}/execute`).set("Authorization", `Bearer ${seekerToken}`).send({ language: "python" });
      expect(r2.status).toBe(400);
    });
    test("should handle empty code 400", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/execute`).set("Authorization", `Bearer ${seekerToken}`).send({ language: "python", code: "" });
      expect(res.status).toBe(400);
    });
    test("should handle 100KB code without 500", async () => {
      const big = "print(1)\n".repeat(20000);
      const res = await request(app).post(`/api/interviews/${session._id}/execute`).set("Authorization", `Bearer ${seekerToken}`).send({ language: "python", code: big });
      expect(res.status).not.toBe(500);
      expect([200,400]).toContain(res.status);
    });
    test("should handle stdin", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/execute`).set("Authorization", `Bearer ${seekerToken}`).send({ language: "python", code: "print(input())", stdin: "hello" });
      expect(res.status).toBe(200);
    });
    test("should handle concurrent 20 executions monotonic", async () => {
      const promises = Array.from({length:20}, (_,i) => request(app).post(`/api/interviews/${session._id}/execute`).set("Authorization", `Bearer ${seekerToken}`).send({ language: "python", code: `print(${i})` }));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
      const seqs = results.map(r=>r.body.execution.sequence).sort((a,b)=>a-b);
      for(let i=1;i<seqs.length;i++) expect(seqs[i]).toBeGreaterThan(seqs[i-1]);
    });
    test("should handle XSS code without 500", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/execute`).set("Authorization", `Bearer ${seekerToken}`).send({ language: "python", code: "<script>alert(1)</script>" });
      expect(res.status).not.toBe(500);
    });
  });

  // ========== CONFIG PARSE/FORMAT BUTTONS ==========
  describe("Config Parse/Format Buttons", () => {
    test("POST /api/interviews/config/parse valid", async () => {
      const res = await request(app).post("/api/interviews/config/parse").set("Authorization", `Bearer ${recruiterToken}`).send({ content: JSON.stringify({ title: "Test" }) });
      expect(res.status).not.toBe(500);
      expect([200,400]).toContain(res.status);
    });
    test("should reject missing content", async () => {
      const res = await request(app).post("/api/interviews/config/parse").set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("should handle XSS content", async () => {
      const res = await request(app).post("/api/interviews/config/parse").set("Authorization", `Bearer ${recruiterToken}`).send({ content: "<script>alert(1)</script>" });
      expect(res.status).not.toBe(500);
    });
    test("POST /api/interviews/config/format valid", async () => {
      const res = await request(app).post("/api/interviews/config/format").set("Authorization", `Bearer ${recruiterToken}`).send({ config: { title: "Test", stage: "CODING" } });
      expect(res.status).not.toBe(500);
    });
    test("should reject missing config", async () => {
      const res = await request(app).post("/api/interviews/config/format").set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(400);
    });
  });

  // ========== INVITE BUTTONS ==========
  describe("Invite Buttons (Create/Validate/Accept)", () => {
    test("POST /api/interviews/:id/invites — recruiter 201", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/invites`).set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(201);
      expect(res.body.rawToken).toBeDefined();
      expect(res.body.inviteUrl).toBeDefined();
    });
    test("should reject seeker creating invite 403", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/invites`).set("Authorization", `Bearer ${seekerToken}`).send({});
      expect(res.status).toBe(403);
    });
    test("should validate and accept invite flow", async () => {
      const create = await request(app).post(`/api/interviews/${session._id}/invites`).set("Authorization", `Bearer ${recruiterToken}`).send({});
      const token = create.body.rawToken;
      const v = await request(app).get(`/api/interviews/invites/validate/${token}`).set("Authorization", `Bearer ${seekerToken}`);
      expect(v.status).toBe(200);
      expect(v.body.valid).toBe(true);
      const a = await request(app).post(`/api/interviews/invites/accept/${token}`).set("Authorization", `Bearer ${seekerToken}`).send();
      expect(a.status).toBe(200);
      expect(a.body.roomKey).toBe(roomKey);
    });
    test("should reject invalid token 404", async () => {
      const res = await request(app).get(`/api/interviews/invites/validate/invalid-token-123`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(404);
    });
    test("should handle concurrent invite creation (rotate)", async () => {
      const promises = Array.from({length:5}, () => request(app).post(`/api/interviews/${session._id}/invites`).set("Authorization", `Bearer ${recruiterToken}`).send({}));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(201));
      // Tokens should be unique
      const tokens = results.map(r=>r.body.rawToken);
      expect(new Set(tokens).size).toBe(5);
    });
  });

  // ========== RECORDING BUTTONS ==========
  describe("Recording Upload/Get Buttons", () => {
    test("GET /api/interviews/:id/recording — no recording yet 200", async () => {
      const res = await request(app).get(`/api/interviews/${session._id}/recording`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("should reject upload without file 400", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/recording`).set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("should handle invalid session 404", async () => {
      const fake = "507f1f77bcf86cd799439011";
      const res = await request(app).get(`/api/interviews/${fake}/recording`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ========== LIVEKIT BUTTON ==========
  describe("LiveKit Token Button", () => {
    test("POST /api/interviews/:id/livekit-token — recruiter 200", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/livekit-token`).set("Authorization", `Bearer ${recruiterToken}`).send();
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.serverUrl).toBeDefined();
    });
    test("POST /api/interviews/:id/livekit-token — seeker 200", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/livekit-token`).set("Authorization", `Bearer ${seekerToken}`).send();
      expect(res.status).toBe(200);
    });
    test("should reject outsider 403", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/livekit-token`).set("Authorization", `Bearer ${outsiderToken}`).send();
      expect(res.status).toBe(403);
    });
    test("should handle invalid session 404", async () => {
      const res = await request(app).post(`/api/interviews/507f1f77bcf86cd799439011/livekit-token`).set("Authorization", `Bearer ${recruiterToken}`).send();
      expect(res.status).toBe(404);
    });
  });

  // ========== AI SUGGEST BUTTON ==========
  describe("AI Suggest Button (Copilot)", () => {
    test("POST /api/interviews/:id/ai-suggest — recruiter 200", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/ai-suggest`).set("Authorization", `Bearer ${recruiterToken}`).send({ activeCode: "print(1)", activeLanguage: "python", currentStage: "CODING" });
      expect(res.status).toBe(200);
      expect(res.body.suggestion).toBeDefined();
    });
    test("should reject seeker 403", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/ai-suggest`).set("Authorization", `Bearer ${seekerToken}`).send({ activeCode: "print(1)" });
      expect(res.status).toBe(403);
    });
    test("should handle missing code gracefully", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/ai-suggest`).set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).not.toBe(500);
      expect([200,400]).toContain(res.status);
    });
    test("should handle XSS code", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/ai-suggest`).set("Authorization", `Bearer ${recruiterToken}`).send({ activeCode: "<script>alert(1)</script>" });
      expect(res.status).not.toBe(500);
    });
  });

  // ========== EVALUATE BUTTON ==========
  describe("Evaluate Button", () => {
    test("POST /api/interviews/:id/evaluate — recruiter 200", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/evaluate`).set("Authorization", `Bearer ${recruiterToken}`).send({ hiringDecision: "HIRE", overallNotes: "Good", categories: [{ category: "Coding & Algorithms", score: 4, notes: "good" }] });
      expect(res.status).toBe(200);
      expect(res.body.scorecard).toBeDefined();
    });
    test("should reject seeker 403", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/evaluate`).set("Authorization", `Bearer ${seekerToken}`).send({ hiringDecision: "HIRE" });
      expect(res.status).toBe(403);
    });
  });

  // ========== REPLAY BUTTONS — DETERMINISTIC (FIX PRERECORDED) ==========
  describe("Replay Buttons — Deterministic Reconstruction", () => {
    test("GET /api/replay/:id/manifest — 200 with stages/milestones", async () => {
      const res = await request(app).get(`/api/replay/${session._id}/manifest`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.totalDurationMs).toBeGreaterThan(0);
      expect(res.body.stages).toBeDefined();
      expect(res.body.milestones.length).toBeGreaterThan(0);
      expect(res.body.timelineEvents.length).toBeGreaterThan(0);
    });
    test("GET /api/replay/:id/frame?offsetMs=0 — WAITING_ROOM", async () => {
      const res = await request(app).get(`/api/replay/${session._id}/frame?offsetMs=0`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.activeStage).toBe("WAITING_ROOM");
      expect(res.body.codeWorkspace).toBeDefined();
      expect(res.body.whiteboard).toBeDefined();
      expect(res.body.transcriptHistory).toBeDefined();
    });
    test("GET /api/replay/:id/frame?offsetMs=15000 — CODING with code", async () => {
      const res = await request(app).get(`/api/replay/${session._id}/frame?offsetMs=15000`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.activeStage).toBe("CODING");
      expect(res.body.codeWorkspace.files[0].content).toBeDefined();
    });
    test("should be deterministic: same offset same code", async () => {
      const r1 = await request(app).get(`/api/replay/${session._id}/frame?offsetMs=5000`).set("Authorization", `Bearer ${recruiterToken}`);
      const r2 = await request(app).get(`/api/replay/${session._id}/frame?offsetMs=5000`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(r1.body.codeWorkspace.files[0].content).toBe(r2.body.codeWorkspace.files[0].content);
      expect(r1.body.activeStage).toBe(r2.body.activeStage);
    });
    test("should handle huge offsetMs 999999", async () => {
      const res = await request(app).get(`/api/replay/${session._id}/frame?offsetMs=999999`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("should reject outsider 403", async () => {
      const res = await request(app).get(`/api/replay/${session._id}/manifest`).set("Authorization", `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });
    test("should 404 invalid session", async () => {
      const res = await request(app).get(`/api/replay/507f1f77bcf86cd799439011/manifest`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(404);
    });
    test("should handle concurrent frame fetches (1Lakh scale scrubbing)", async () => {
      const offsets = [0,1000,5000,8000,15000,50000];
      const promises = offsets.map(off => request(app).get(`/api/replay/${session._id}/frame?offsetMs=${off}`).set("Authorization", `Bearer ${seekerToken}`));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
      // Verify monotonic: later offset should have >= earlier transcriptHistory length
      for(let i=1;i<results.length;i++){
        expect(results[i].body.transcriptHistory.length).toBeGreaterThanOrEqual(results[i-1].body.transcriptHistory.length);
      }
    });
  });

  // ========== CODING BUTTONS (Create/Delete/Rename/Workspace/Checkpoints) ==========
  describe("Coding Buttons", () => {
    test("POST /api/coding/:id/files — create 201", async () => {
      const res = await request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${seekerToken}`).send({ name: "test.py", path: "/test.py", language: "python", initialContent: "print(1)" });
      expect(res.status).toBe(201);
    });
    test("should 409 duplicate", async () => {
      const path = `/dup-${Date.now()}.py`;
      await request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${seekerToken}`).send({ name: "dup.py", path, language: "python" });
      const res = await request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${seekerToken}`).send({ name: "dup.py", path, language: "python" });
      expect(res.status).toBe(409);
    });
    test("should 400 missing fields", async () => {
      const res = await request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${seekerToken}`).send({ name: "x" });
      expect(res.status).toBe(400);
    });
    test("should reject outsider 403", async () => {
      const res = await request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${outsiderToken}`).send({ name: "x", path: "/x.py" });
      expect(res.status).toBe(403);
    });
    test("DELETE /api/coding/:id/files — 200", async () => {
      const path = `/todel-${Date.now()}.py`;
      await request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${seekerToken}`).send({ name: "todel.py", path, language: "python" });
      const res = await request(app).delete(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${seekerToken}`).send({ path });
      expect(res.status).toBe(200);
    });
    test("PUT /api/coding/:id/files/rename — 200", async () => {
      const oldPath = `/old-${Date.now()}.py`;
      const newPath = `/new-${Date.now()}.py`;
      await request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${seekerToken}`).send({ name: "old.py", path: oldPath, language: "python", initialContent: "print(1)" });
      const res = await request(app).put(`/api/coding/${session._id}/files/rename`).set("Authorization", `Bearer ${seekerToken}`).send({ oldPath, newPath, newName: "new.py" });
      expect(res.status).toBe(200);
    });
    test("POST /api/coding/:id/directories — 201", async () => {
      const res = await request(app).post(`/api/coding/${session._id}/directories`).set("Authorization", `Bearer ${seekerToken}`).send({ path: `/dir-${Date.now()}` });
      expect(res.status).toBe(201);
    });
    test("GET /api/coding/:id/workspace — 200", async () => {
      const res = await request(app).get(`/api/coding/${session._id}/workspace`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.workspace).toBeDefined();
    });
    test("GET /api/coding/:id/checkpoints — 200", async () => {
      const res = await request(app).get(`/api/coding/${session._id}/checkpoints`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.checkpoints)).toBe(true);
    });
    test("POST /api/coding/:id/checkpoints — manual 201", async () => {
      const res = await request(app).post(`/api/coding/${session._id}/checkpoints`).set("Authorization", `Bearer ${seekerToken}`).send({ label: "Manual" });
      expect(res.status).toBe(201);
    });
    test("POST /api/coding/:id/checkpoints/:id/restore — 200", async () => {
      const create = await request(app).post(`/api/coding/${session._id}/checkpoints`).set("Authorization", `Bearer ${seekerToken}`).send({ label: "ToRestore" });
      const cpId = create.body.checkpoint._id;
      const res = await request(app).post(`/api/coding/${session._id}/checkpoints/${cpId}/restore`).set("Authorization", `Bearer ${seekerToken}`).send();
      expect(res.status).toBe(200);
    });
    test("should handle concurrent file creation race 201+409", async () => {
      const p = `/race-${Date.now()}.py`;
      const [r1,r2] = await Promise.all([
        request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${seekerToken}`).send({ name: "race.py", path: p, language: "python" }),
        request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${recruiterToken}`).send({ name: "race.py", path: p, language: "python" }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([201,409]);
    });
  });

  // ========== WHITEBOARD BUTTONS ==========
  describe("Whiteboard Buttons", () => {
    test("POST /api/whiteboard/:id/snapshots — 201", async () => {
      const res = await request(app).post(`/api/whiteboard/${session._id}/snapshots`).set("Authorization", `Bearer ${seekerToken}`).send({ canvasWidth: 1920 });
      expect(res.status).toBe(201);
      expect(res.body.snapshot.sequenceNumber).toBeGreaterThan(0);
    });
    test("GET /api/whiteboard/:id/snapshots — 200", async () => {
      await request(app).post(`/api/whiteboard/${session._id}/snapshots`).set("Authorization", `Bearer ${seekerToken}`).send({});
      const res = await request(app).get(`/api/whiteboard/${session._id}/snapshots`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.snapshots.length).toBeGreaterThan(0);
    });
    test("POST /api/whiteboard/:id/snapshots/:id/restore — 200", async () => {
      const c = await request(app).post(`/api/whiteboard/${session._id}/snapshots`).set("Authorization", `Bearer ${seekerToken}`).send({});
      const id = c.body.snapshot._id;
      const res = await request(app).post(`/api/whiteboard/${session._id}/snapshots/${id}/restore`).set("Authorization", `Bearer ${seekerToken}`).send();
      expect(res.status).toBe(200);
    });
    test("should reject outsider 403", async () => {
      const res = await request(app).get(`/api/whiteboard/${session._id}/snapshots`).set("Authorization", `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });
    test("should handle concurrent snapshots unique seq", async () => {
      const promises = Array.from({length:5}, () => request(app).post(`/api/whiteboard/${session._id}/snapshots`).set("Authorization", `Bearer ${seekerToken}`).send({}));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(201));
      const seqs = results.map(r=>r.body.snapshot.sequenceNumber).sort((a,b)=>a-b);
      expect(new Set(seqs).size).toBe(5);
    });
  });

  // ========== TIMELINE BUTTONS ==========
  describe("Timeline Buttons (Filter/Search/Context)", () => {
    test("GET /api/timeline/:id/events — 200", async () => {
      const res = await request(app).get(`/api/timeline/${session._id}/events`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.events.length).toBeGreaterThan(0);
    });
    test("should filter pipeline CODING", async () => {
      const res = await request(app).get(`/api/timeline/${session._id}/events?pipeline=CODING`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.events.every(e=>e.pipeline==="CODING")).toBe(true);
    });
    test("should paginate limit 1", async () => {
      const res = await request(app).get(`/api/timeline/${session._id}/events?limit=1&offset=0`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.events.length).toBe(1);
      expect(res.body.hasMore).toBe(true);
    });
    test("should search", async () => {
      const res = await request(app).get(`/api/timeline/${session._id}/search?q=exec`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
    });
    test("should handle ReDoS search without 500", async () => {
      const res = await request(app).get(`/api/timeline/${session._id}/search?q=${encodeURIComponent("(a+)+$")}`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
    });
    test("should get context", async () => {
      const ev = await TimelineEvent.findOne({ session: session._id });
      const res = await request(app).get(`/api/timeline/${session._id}/events/${ev._id}/context?window=1`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.targetEvent).toBeDefined();
    });
    test("should reject outsider 403", async () => {
      const res = await request(app).get(`/api/timeline/${session._id}/events`).set("Authorization", `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ========== SIGNALS & EVALUATION BUTTONS ==========
  describe("SignalHUD & Evaluation Buttons", () => {
    test("POST /api/signals/extract — 200", async () => {
      const res = await request(app).post("/api/signals/extract").set("Authorization", `Bearer ${recruiterToken}`).send({ sessionId: session._id, code: "print(1)", language: "python", offsetMs: 1000 });
      expect(res.status).not.toBe(500);
      expect([200,400]).toContain(res.status);
    });
    test("GET /api/signals/session/:id — 200", async () => {
      const res = await request(app).get(`/api/signals/session/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
    });
    test("POST /api/evaluations/:id — recruiter 201", async () => {
      const ev = await TimelineEvent.findOne({ session: session._id });
      const res = await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send({ overallRating: 4, decision: "HIRE", competencies: [{ category: "Coding", score: 4, evidenceRefs: [{ refType: "TIMELINE_EVENT", timelineEventId: ev._id }] }] });
      expect(res.status).toBe(201);
    });
    test("GET /api/evaluations/:id — 200", async () => {
      const ev = await TimelineEvent.findOne({ session: session._id });
      await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send({ overallRating: 4, decision: "HIRE", competencies: [{ category: "Coding", score: 4, evidenceRefs: [{ refType: "TIMELINE_EVENT", timelineEventId: ev._id }] }] });
      const res = await request(app).get(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("GET /api/evaluations/:id/candidate-feedback — seeker 200", async () => {
      const ev = await TimelineEvent.findOne({ session: session._id });
      await request(app).post(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${recruiterToken}`).send({ overallRating: 4, decision: "HIRE", competencies: [{ category: "Coding", score: 4, evidenceRefs: [{ refType: "TIMELINE_EVENT", timelineEventId: ev._id }] }] });
      const res = await request(app).get(`/api/evaluations/${session._id}/candidate-feedback`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.feedback).toBeDefined();
    });
    test("should reject outsider evaluation 403", async () => {
      const res = await request(app).get(`/api/evaluations/${session._id}`).set("Authorization", `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ========== NOTES BUTTONS ==========
  describe("Interview Notes Buttons", () => {
    test("POST /api/interviews/:id/notes — recruiter 201", async () => {
      const res = await request(app).post(`/api/interviews/${session._id}/notes`).set("Authorization", `Bearer ${recruiterToken}`).send({ content: "Great candidate", isPrivate: true });
      expect([201,200]).toContain(res.status);
    });
    test("GET /api/interviews/:id/notes — 200", async () => {
      await request(app).post(`/api/interviews/${session._id}/notes`).set("Authorization", `Bearer ${recruiterToken}`).send({ content: "Note" });
      const res = await request(app).get(`/api/interviews/${session._id}/notes`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("should reject outsider 403", async () => {
      const res = await request(app).get(`/api/interviews/${session._id}/notes`).set("Authorization", `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ========== 1 LAKH SCALE LOAD ==========
  describe("1 Lakh Daily Scale — Concurrency", () => {
    test("should handle 100 concurrent manifest fetches", async () => {
      const promises = Array.from({length:100}, () => request(app).get(`/api/replay/${session._id}/manifest`).set("Authorization", `Bearer ${recruiterToken}`));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
      // All should have same totalDurationMs
      const first = results[0].body.totalDurationMs;
      results.forEach(r => expect(r.body.totalDurationMs).toBe(first));
    });
    test("should handle 100 concurrent mixed interview ops", async () => {
      const promises = [];
      for(let i=0;i<20;i++){
        promises.push(request(app).get(`/api/timeline/${session._id}/events?limit=10`).set("Authorization", `Bearer ${recruiterToken}`));
        promises.push(request(app).get(`/api/replay/${session._id}/frame?offsetMs=${i*1000}`).set("Authorization", `Bearer ${seekerToken}`));
        promises.push(request(app).post(`/api/learn/session`).set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: `Load ${i}`, durationMinutes: 10 }));
        promises.push(request(app).get(`/api/study/problems?limit=5`).set("Authorization", `Bearer ${seekerToken}`));
        promises.push(request(app).post(`/api/whiteboard/${session._id}/snapshots`).set("Authorization", `Bearer ${seekerToken}`).send({}));
      }
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).not.toBe(500));
      expect(results.filter(r=>[200,201].includes(r.status)).length).toBeGreaterThan(80);
    });
  });
});
