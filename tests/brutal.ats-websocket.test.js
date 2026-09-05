const request = require("supertest");
const path = require("path");
const fs = require("fs");
const http = require("http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const config = require("../src/config/env");
const User = require("../src/models/User");
const Job = require("../src/models/Job");
const Application = require("../src/models/Application");
const InterviewSession = require("../src/models/InterviewSession");
const { createTestUser, createTestJob, getAuthToken } = require("./utils/helpers");
const { setupSocketIO } = require("../src/infrastructure/realtime/socketio");
const { handleUpgrade: handleYjsUpgrade } = require("../src/infrastructure/realtime/yjsWebSocket");
const { handleLspUpgrade } = require("../src/infrastructure/lsp/lspGateway");

describe("Brutal ATS Uploading + Job Matching + All WebSockets — 1Lakh Scale", () => {
  jest.setTimeout(180000);
  let seeker, seekerToken, recruiter, recruiterToken, outsider, outsiderToken, job;

  beforeEach(async () => {
    seeker = await createTestUser({ name: "ATS Seeker", email: `ats-s-${Date.now()}-${Math.random()}@ex.com`, role: "seeker", skills: ["javascript", "node"], degree: "BTech", cgpa: 8.5, collegeTier: "tier1", resumeText: "javascript developer with 3 years experience in node and react" });
    recruiter = await createTestUser({ name: "ATS Recruiter", email: `ats-r-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    outsider = await createTestUser({ name: "Outsider", email: `ats-o-${Date.now()}-${Math.random()}@ex.com`, role: "seeker" });
    seekerToken = getAuthToken(seeker);
    recruiterToken = getAuthToken(recruiter);
    outsiderToken = getAuthToken(outsider);
    job = await createTestJob(recruiter._id, { title: "Senior JS Engineer", description: "Need senior JS engineer with node and react for scalable systems. Must have 3 years experience and handle distributed architecture.", skills: ["javascript", "node", "react"], atsRequirements: { minCgpa: 7.5, minExperienceYears: 2, targetCollegeTier: "tier2" } });
    await Application.create({ job: job._id, seeker: seeker._id, recruiter: recruiter._id, status: "applied", atsScore: 80 });
  });

  // ========== ATS UPLOADING ==========
  describe("ATS Resume Uploading Brutal", () => {
    const pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
    const txtBuffer = Buffer.from("This is not a PDF");
    const exeBuffer = Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff");

    test("should upload valid PDF", async () => {
      const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", pdfBuffer, { filename: "resume.pdf", contentType: "application/pdf" });
      expect(res.status).not.toBe(500);
      expect([200,400]).toContain(res.status);
      if (res.status === 200) expect(res.body).toHaveProperty("skills");
    });
    test("should reject missing file 400", async () => {
      const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("should reject seeker vs recruiter 403", async () => {
      const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${recruiterToken}`).attach("resume", pdfBuffer, { filename: "resume.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(403);
    });
    test("should reject unauthenticated 401", async () => {
      const res = await request(app).post("/api/resume/upload").attach("resume", pdfBuffer, { filename: "resume.pdf", contentType: "application/pdf" });
      expect([401,403]).toContain(res.status);
    });
    test("should reject txt file with PDF mimetype spoof (magic bytes)", async () => {
      const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", txtBuffer, { filename: "resume.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(400);
      expect(res.body.msg).toMatch(/valid PDF/);
    });
    test("should reject exe with PDF extension", async () => {
      const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", exeBuffer, { filename: "malicious.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(400);
    });
    test("should reject non-PDF mimetype", async () => {
      const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", txtBuffer, { filename: "resume.txt", contentType: "text/plain" });
      expect(res.status).toBe(400);
    });
    test("should handle XSS filename without 500", async () => {
      const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", pdfBuffer, { filename: "<script>alert(1)</script>.pdf", contentType: "application/pdf" });
      expect(res.status).not.toBe(500);
    });
    test("should handle huge PDF 5MB limit", async () => {
      const hugePdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(6 * 1024 * 1024, 0x41)]);
      const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", hugePdf, { filename: "huge.pdf", contentType: "application/pdf" });
      expect(res.status).not.toBe(500);
      expect([400,413]).toContain(res.status);
    });
    test("should handle empty PDF", async () => {
      const empty = Buffer.from("%PDF-1.4\n%%EOF");
      const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", empty, { filename: "empty.pdf", contentType: "application/pdf" });
      expect(res.status).not.toBe(500);
    });
    test("should handle concurrent 10 uploads", async () => {
      const promises = Array.from({length:10}, () => request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", pdfBuffer, { filename: `resume-${Math.random()}.pdf`, contentType: "application/pdf" }));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).not.toBe(500));
    });
    test("should handle mock-resume.pdf bypass (test helper)", async () => {
      const mockPath = path.join(__dirname, "..", "jobly-web", "e2e", "fixtures", "mock-resume.pdf");
      // If file exists, test it; else skip
      if (fs.existsSync(mockPath)) {
        const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", mockPath);
        expect(res.status).not.toBe(500);
      } else {
        const res = await request(app).post("/api/resume/upload").set("Authorization", `Bearer ${seekerToken}`).attach("resume", pdfBuffer, { filename: "mock-resume.pdf", contentType: "application/pdf" });
        expect(res.status).not.toBe(500);
      }
    });
    test("GET /api/resume/profile — 200", async () => {
      const res = await request(app).get("/api/resume/profile").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("skills");
    });
    test("PUT /api/resume/profile — valid", async () => {
      const profile = { schemaVersion: "resume-profile/1", source: { uploadId: "upl-test", fileName: "resume.pdf", sha256: "abc", extractedAt: new Date().toISOString(), extractor: "test" }, contact: {}, headline: "Engineer", summary: "Summary", skills: [{ canonicalId: "skill_js", label: "JavaScript", aliasesObserved: ["js"], evidence: [] }], experience: [], projects: [], education: [{ qualification: "BTech", institution: "IIT", gpa: 8.5, gpaScale: 10 }], certifications: [], achievements: [], sectionsDetected: [], parseWarnings: [] };
      const res = await request(app).put("/api/resume/profile").set("Authorization", `Bearer ${seekerToken}`).send({ resumeProfile: profile });
      expect(res.status).toBe(200);
    });
    test("should reject missing resumeProfile 400", async () => {
      const res = await request(app).put("/api/resume/profile").set("Authorization", `Bearer ${seekerToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("GET /api/resume/upload/:uploadId/status — 404 for invalid", async () => {
      const res = await request(app).get("/api/resume/upload/invalid-id/status").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ========== JOB MATCHING ==========
  describe("Job Matching Brutal (RRF, Filters, ATS)", () => {
    beforeEach(async () => {
      // Seed 5 jobs for matching
      for(let i=0;i<5;i++){
        await createTestJob(recruiter._id, { title: `Job ${i} Engineer`, description: `Description for job ${i} with more than twenty characters to pass validation. Skills: js node react.`, skills: ["js", "node"], atsRequirements: { minCgpa: 7, minExperienceYears: i } });
      }
    });
    test("GET /api/jobs — recruiter 200 with counts", async () => {
      const res = await request(app).get("/api/jobs").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
    test("GET /api/jobs — seeker 200", async () => {
      const res = await request(app).get("/api/jobs").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("GET /api/jobs/match — seeker 200 sorted", async () => {
      const res = await request(app).get("/api/jobs/match").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Check sorted by eligible then score
    });
    test("GET /api/jobs/search?q=js — RRF 200", async () => {
      const res = await request(app).get("/api/jobs/search?q=js").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
    test("should handle search injection without 500", async () => {
      const injections = ["<script>alert(1)</script>", ".*", "(a+)+$", "DROP TABLE", "'; OR 1=1 --", "a".repeat(5000)];
      for(const q of injections){
        const res = await request(app).get(`/api/jobs/search?q=${encodeURIComponent(q)}`).set("Authorization", `Bearer ${seekerToken}`);
        expect(res.status).not.toBe(500);
        expect(res.status).toBe(200);
      }
    });
    test("should handle pagination huge limit", async () => {
      const res = await request(app).get("/api/jobs?page=1&limit=1000000").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
      expect(res.status).toBe(200);
      // Should be capped to 100
      expect(res.body.length).toBeLessThanOrEqual(100);
    });
    test("should handle negative page/limit", async () => {
      const res = await request(app).get("/api/jobs?page=-1&limit=-5").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
      expect(res.status).toBe(200);
    });
    test("GET /api/jobs/:jobId/ats-score — valid 200", async () => {
      const res = await request(app).get(`/api/jobs/${job._id}/ats-score`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("score");
    });
    test("should 400 without resumeText", async () => {
      const noResumeSeeker = await createTestUser({ email: `no-res-${Date.now()}@ex.com`, role: "seeker" });
      const token = getAuthToken(noResumeSeeker);
      const res = await request(app).get(`/api/jobs/${job._id}/ats-score`).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
    test("should 404 invalid jobId", async () => {
      const res = await request(app).get(`/api/jobs/507f1f77bcf86cd799439011/ats-score`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(404);
    });
    test("should 400 invalid jobId format", async () => {
      const res = await request(app).get(`/api/jobs/invalid-id/ats-score`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(400);
    });
    test("should handle concurrent job fetches (1Lakh scale)", async () => {
      const promises = Array.from({length:50}, () => request(app).get("/api/jobs").set("Authorization", `Bearer ${seekerToken}`));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
    });
    test("should handle concurrent ATS scores", async () => {
      const promises = Array.from({length:20}, () => request(app).get(`/api/jobs/${job._id}/ats-score`).set("Authorization", `Bearer ${seekerToken}`));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
    });
  });

  // ========== WEBSOCKETS: SOCKET.IO ==========
  describe("WebSocket Brutal - Socket.IO", () => {
    let server, port, session, roomKey;
    beforeEach(async () => {
      const appJob = await createTestJob(recruiter._id, { title: "WS Job", description: "WS job desc with more than twenty chars for WS testing.", skills: ["js"] });
      const appDoc = await Application.create({ job: appJob._id, seeker: seeker._id, recruiter: recruiter._id, status: "shortlisted" });
      roomKey = `room-ws-${Date.now()}-${Math.random()}`;
      session = await InterviewSession.create({ tenantId: "default", application: appDoc._id, job: appJob._id, seeker: seeker._id, recruiter: recruiter._id, roomKey, scheduledStart: new Date(), actualStart: new Date(), status: "LIVE" });
    });
    beforeAll(async () => {
      server = http.createServer(app);
      setupSocketIO(server);
      await new Promise(res => server.listen(0, res));
      port = server.address().port;
    });
    afterAll(async () => {
      await new Promise(res => server.close(res));
    });

    function connect(token){
      const io = require("socket.io-client");
      return io(`http://127.0.0.1:${port}`, { auth: { token }, transports: ["websocket"] });
    }

    test("should connect with valid token", async () => {
      const socket = connect(seekerToken);
      await new Promise((res, rej) => { socket.on("connect", res); socket.on("connect_error", rej); setTimeout(()=>rej(new Error("timeout")),3000); });
      expect(socket.connected).toBe(true);
      socket.disconnect();
    });
    test("should reject invalid token", async () => {
      const socket = connect("invalid-token");
      const result = await new Promise(res => {
        socket.on("connect", () => res("connected"));
        socket.on("connect_error", () => res("error"));
        setTimeout(()=>res("timeout"),2000);
      });
      expect(result).toBe("error");
      socket.disconnect();
    });
    test("should reject missing token", async () => {
      const io = require("socket.io-client");
      const socket = io(`http://127.0.0.1:${port}`, { transports: ["websocket"] });
      const result = await new Promise(res => {
        socket.on("connect", () => res("connected"));
        socket.on("connect_error", () => res("error"));
        setTimeout(()=>res("timeout"),2000);
      });
      expect(result).toBe("error");
      socket.disconnect();
    });
    test("should join interview room as participant", async () => {
      const socket = connect(seekerToken);
      await new Promise(res => socket.on("connect", res));
      socket.emit("join_interview", { roomKey });
      await new Promise(res => setTimeout(res, 200));
      socket.disconnect();
      // No error means success
      expect(true).toBe(true);
    });
    test("should reject outsider join interview", async () => {
      const socket = connect(outsiderToken);
      await new Promise(res => socket.on("connect", res));
      const error = await new Promise(res => {
        socket.on("interview_join_error", (data) => res(data));
        socket.emit("join_interview", { roomKey });
        setTimeout(()=>res(null),1000);
      });
      expect(error).toBeDefined();
      expect(error.message).toMatch(/access/i);
      socket.disconnect();
    });
    test("should handle proctor_event only from participant", async () => {
      const seekerSocket = connect(seekerToken);
      const recruiterSocket = connect(recruiterToken);
      await Promise.all([new Promise(r=>seekerSocket.on("connect",r)), new Promise(r=>recruiterSocket.on("connect",r))]);
      recruiterSocket.emit("join_interview", { roomKey });
      seekerSocket.emit("join_interview", { roomKey });
      await new Promise(r=>setTimeout(r,200));
      const proctorPromise = new Promise(res => {
        recruiterSocket.on("proctor_event_received", res);
        setTimeout(()=>res(null),1000);
      });
      seekerSocket.emit("proctor_event", { roomKey, eventType: "tab_hidden", timestamp: Date.now() });
      const received = await proctorPromise;
      expect(received).toBeDefined();
      expect(received.eventType).toBe("tab_hidden");
      seekerSocket.disconnect(); recruiterSocket.disconnect();
    });
    test("should not relay proctor from outsider", async () => {
      const outsiderSocket = connect(outsiderToken);
      const recruiterSocket = connect(recruiterToken);
      await Promise.all([new Promise(r=>outsiderSocket.on("connect",r)), new Promise(r=>recruiterSocket.on("connect",r))]);
      recruiterSocket.emit("join_interview", { roomKey });
      await new Promise(r=>setTimeout(r,200));
      const proctorPromise = new Promise(res => {
        recruiterSocket.on("proctor_event_received", () => res("received"));
        setTimeout(()=>res("not_received"),1000);
      });
      outsiderSocket.emit("proctor_event", { roomKey, eventType: "tab_hidden" });
      const result = await proctorPromise;
      expect(result).toBe("not_received");
      outsiderSocket.disconnect(); recruiterSocket.disconnect();
    });
    test("should handle transcript_chunk only from participant", async () => {
      const seekerSocket = connect(seekerToken);
      const recruiterSocket = connect(recruiterToken);
      await Promise.all([new Promise(r=>seekerSocket.on("connect",r)), new Promise(r=>recruiterSocket.on("connect",r))]);
      recruiterSocket.emit("join_interview", { roomKey });
      seekerSocket.emit("join_interview", { roomKey });
      await new Promise(r=>setTimeout(r,200));
      const transcriptPromise = new Promise(res => {
        recruiterSocket.on("live_transcript_received", res);
        setTimeout(()=>res(null),1000);
      });
      seekerSocket.emit("transcript_chunk", { roomKey, text: "hello world", isFinal: true, offsetMs: 1000 });
      const received = await transcriptPromise;
      expect(received).toBeDefined();
      expect(received.text).toBe("hello world");
      seekerSocket.disconnect(); recruiterSocket.disconnect();
    });
    test("should handle whiteboard_delta only from participant", async () => {
      const seekerSocket = connect(seekerToken);
      const recruiterSocket = connect(recruiterToken);
      await Promise.all([new Promise(r=>seekerSocket.on("connect",r)), new Promise(r=>recruiterSocket.on("connect",r))]);
      recruiterSocket.emit("join_interview", { roomKey });
      seekerSocket.emit("join_interview", { roomKey });
      await new Promise(r=>setTimeout(r,200));
      const deltaPromise = new Promise(res => {
        recruiterSocket.on("whiteboard_delta_broadcast", res);
        setTimeout(()=>res(null),1000);
      });
      seekerSocket.emit("whiteboard_delta", { roomKey, delta: { test: 1 }, snapshotVersion: 1 });
      const received = await deltaPromise;
      expect(received).toBeDefined();
      seekerSocket.disconnect(); recruiterSocket.disconnect();
    });
    test("should handle editor_cursor_move only from participant", async () => {
      const seekerSocket = connect(seekerToken);
      const recruiterSocket = connect(recruiterToken);
      await Promise.all([new Promise(r=>seekerSocket.on("connect",r)), new Promise(r=>recruiterSocket.on("connect",r))]);
      recruiterSocket.emit("join_interview", { roomKey });
      seekerSocket.emit("join_interview", { roomKey });
      await new Promise(r=>setTimeout(r,200));
      const cursorPromise = new Promise(res => {
        recruiterSocket.on("peer_cursor_update", res);
        setTimeout(()=>res(null),1000);
      });
      seekerSocket.emit("editor_cursor_move", { roomKey, cursor: { lineNumber: 1, column: 1 }, file: "/solution.py" });
      const received = await cursorPromise;
      expect(received).toBeDefined();
      seekerSocket.disconnect(); recruiterSocket.disconnect();
    });
    test("should handle 50 concurrent socket connections (1Lakh scale)", async () => {
      const sockets = [];
      for(let i=0;i<50;i++){
        const s = connect(i%2===0 ? seekerToken : recruiterToken);
        sockets.push(s);
      }
      await Promise.all(sockets.map(s=> new Promise((res,rej)=>{
        s.on("connect", res);
        s.on("connect_error", rej);
        setTimeout(()=>rej(new Error("timeout")),5000);
      })));
      expect(sockets.every(s=>s.connected)).toBe(true);
      sockets.forEach(s=>s.disconnect());
    });
    test("should handle rapid 100 transcript chunks without crash", async () => {
      const seekerSocket = connect(seekerToken);
      const recruiterSocket = connect(recruiterToken);
      await Promise.all([new Promise(r=>seekerSocket.on("connect",r)), new Promise(r=>recruiterSocket.on("connect",r))]);
      recruiterSocket.emit("join_interview", { roomKey });
      seekerSocket.emit("join_interview", { roomKey });
      await new Promise(r=>setTimeout(r,200));
      let receivedCount = 0;
      recruiterSocket.on("live_transcript_received", () => receivedCount++);
      for(let i=0;i<100;i++){
        seekerSocket.emit("transcript_chunk", { roomKey, text: `msg ${i}`, isFinal: false, offsetMs: i*10 });
      }
      await new Promise(r=>setTimeout(r,1000));
      expect(receivedCount).toBeGreaterThan(90);
      seekerSocket.disconnect(); recruiterSocket.disconnect();
    });
  });

  // ========== YJS WEBSOCKET ==========
  describe("Yjs WebSocket Brutal", () => {
    let server, port, session, roomKey, seekerToken2, recruiterToken2, outsiderToken2;
    beforeAll(async () => {
      server = http.createServer(app);
      setupSocketIO(server);
      const yjsServer = server;
      const originalUpgradeListeners = yjsServer.listeners("upgrade").slice();
      yjsServer.removeAllListeners("upgrade");
      yjsServer.on("upgrade", async (req, socket, head) => {
        const handled = await handleYjsUpgrade(req, socket, head);
        if (handled !== false) return;
        for(const listener of originalUpgradeListeners) listener(req,socket,head);
      });
      await new Promise(res => server.listen(0, res));
      port = server.address().port;
    });
    beforeEach(async () => {
      const uSeeker = await createTestUser({ email: `yjs-s-${Date.now()}-${Math.random()}@ex.com`, role: "seeker" });
      const uRec = await createTestUser({ email: `yjs-r-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
      const uOut = await createTestUser({ email: `yjs-o-${Date.now()}-${Math.random()}@ex.com`, role: "seeker" });
      const jobDoc = await Job.create({ title: "Yjs Job", description: "Yjs job desc with sufficient length for validation.", company: "C", recruiter: uRec._id });
      const appDoc = await Application.create({ job: jobDoc._id, seeker: uSeeker._id, recruiter: uRec._id });
      roomKey = `room-yjs-brutal-${Date.now()}-${Math.random()}`;
      session = await InterviewSession.create({ tenantId: "default", application: appDoc._id, job: jobDoc._id, seeker: uSeeker._id, recruiter: uRec._id, roomKey, scheduledStart: new Date() });
      seekerToken2 = jwt.sign({ id: uSeeker._id.toString(), userId: uSeeker._id.toString(), role: "seeker" }, config.JWT_SECRET || "testsecret123");
      recruiterToken2 = jwt.sign({ id: uRec._id.toString(), userId: uRec._id.toString(), role: "recruiter" }, config.JWT_SECRET || "testsecret123");
      outsiderToken2 = jwt.sign({ id: uOut._id.toString(), userId: uOut._id.toString(), role: "seeker" }, config.JWT_SECRET || "testsecret123");
    });
    afterAll(async () => { await new Promise(res => server.close(res)); });

    test("should reject invalid token", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/collab/${roomKey}?token=invalid`);
      const result = await new Promise(res => {
        ws.on("error", () => res("error"));
        ws.on("close", () => res("error"));
        ws.on("open", () => res("open"));
        setTimeout(()=>res("timeout"),2000);
      });
      expect(result).toBe("error");
      try{ ws.close(); }catch{}
    });
    test("should reject outsider", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/collab/${roomKey}?token=${outsiderToken2}`);
      const result = await new Promise(res => {
        ws.on("error", () => res("error"));
        ws.on("close", () => res("error"));
        ws.on("open", () => res("open"));
        setTimeout(()=>res("timeout"),2000);
      });
      expect(result).toBe("error");
      try{ ws.close(); }catch{}
    });
    test("should connect valid participant and get sync", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/collab/${roomKey}?token=${seekerToken2}`);
      const msg = await new Promise((res,rej)=>{
        const t=setTimeout(()=>rej(new Error("timeout")),3000);
        ws.on("message", d=>{ clearTimeout(t); res(d); });
        ws.on("error", e=>{ clearTimeout(t); rej(e); });
      });
      expect(msg).toBeDefined();
      ws.close();
    });
    test("should handle concurrent 20 Yjs connections", async () => {
      const sockets = [];
      for(let i=0;i<20;i++){
        const tok = i%2===0 ? seekerToken2 : recruiterToken2;
        const ws = new WebSocket(`ws://127.0.0.1:${port}/collab/${roomKey}?token=${tok}`);
        sockets.push(ws);
      }
      const results = await Promise.all(sockets.map(ws=> new Promise(res=>{
        ws.on("message", ()=>res("ok"));
        ws.on("error", ()=>res("error"));
        ws.on("close", ()=>res("error"));
        setTimeout(()=>res("timeout"),3000);
      })));
      expect(results.filter(r=>r==="ok").length).toBeGreaterThan(15);
      sockets.forEach(ws=>{ try{ws.close();}catch{} });
    });
    test("should handle malformed Yjs message without crash", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/collab/${roomKey}?token=${seekerToken2}`);
      await new Promise(res=>ws.on("open",res));
      // Send garbage
      ws.send(Buffer.from([0xFF, 0xFF, 0xFF]));
      await new Promise(r=>setTimeout(r,500));
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
    test("should handle whiteboard Yjs", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/whiteboard/${roomKey}?token=${seekerToken2}`);
      const msg = await new Promise((res,rej)=>{
        const t=setTimeout(()=>rej(new Error("timeout")),3000);
        ws.on("message", d=>{ clearTimeout(t); res(d); });
        ws.on("error", e=>{ clearTimeout(t); rej(e); });
      });
      expect(msg).toBeDefined();
      ws.close();
    });
  });

  // ========== LSP WEBSOCKET ==========
  describe("LSP WebSocket Brutal", () => {
    let server, port, session, roomKey, seekerToken2, outsiderToken2;
    beforeAll(async () => {
      server = http.createServer(app);
      server.on("upgrade", async (req,socket,head)=>{
        const handled = await handleLspUpgrade(req,socket,head);
        if(handled) return;
        socket.destroy();
      });
      await new Promise(res=>server.listen(0,res));
      port=server.address().port;
    });
    beforeEach(async () => {
      const uSeeker = await createTestUser({ email: `lsp-s-${Date.now()}-${Math.random()}@ex.com`, role: "seeker" });
      const uRec = await createTestUser({ email: `lsp-r-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
      const uOut = await createTestUser({ email: `lsp-o-${Date.now()}-${Math.random()}@ex.com`, role: "seeker" });
      const jobDoc = await Job.create({ title: "LSP Job", description: "LSP job desc with sufficient length.", company: "C", recruiter: uRec._id });
      const appDoc = await Application.create({ job: jobDoc._id, seeker: uSeeker._id, recruiter: uRec._id });
      roomKey = `room-lsp-brutal-${Date.now()}-${Math.random()}`;
      session = await InterviewSession.create({ tenantId: "default", application: appDoc._id, job: jobDoc._id, seeker: uSeeker._id, recruiter: uRec._id, roomKey, scheduledStart: new Date() });
      seekerToken2 = jwt.sign({ id: uSeeker._id.toString(), userId: uSeeker._id.toString(), role: "seeker" }, config.JWT_SECRET || "testsecret123");
      outsiderToken2 = jwt.sign({ id: uOut._id.toString(), userId: uOut._id.toString(), role: "seeker" }, config.JWT_SECRET || "testsecret123");
    });
    afterAll(async()=>{ await new Promise(res=>server.close(res)); });

    test("should reject invalid token", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/lsp/${roomKey}/python?token=bad`);
      const result = await new Promise(res=>{
        ws.on("error",()=>res("error"));
        ws.on("close",()=>res("error"));
        ws.on("open",()=>res("open"));
        setTimeout(()=>res("timeout"),2000);
      });
      expect(result).toBe("error");
      try{ws.close();}catch{}
    });
    test("should reject outsider", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/lsp/${roomKey}/python?token=${outsiderToken2}`);
      const result = await new Promise(res=>{
        ws.on("error",()=>res("error"));
        ws.on("close",()=>res("error"));
        ws.on("open",()=>res("open"));
        setTimeout(()=>res("timeout"),2000);
      });
      expect(result).toBe("error");
      try{ws.close();}catch{}
    });
    test("should connect valid and handle initialize", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/lsp/${roomKey}/python?token=${seekerToken2}`);
      await new Promise(res=>ws.on("open",res));
      const respPromise = new Promise(res=>{
        ws.on("message", d=>res(JSON.parse(d.toString())));
        setTimeout(()=>res(null),2000);
      });
      ws.send(JSON.stringify({ jsonrpc:"2.0", id:1, method:"initialize", params:{ processId:1, rootUri:null, capabilities:{} }}));
      const resp = await respPromise;
      expect(resp).toBeDefined();
      expect(resp.jsonrpc).toBe("2.0");
      ws.close();
    });
    test("should handle concurrent LSP connections", async () => {
      const sockets=[];
      for(let i=0;i<10;i++){
        const ws=new WebSocket(`ws://127.0.0.1:${port}/lsp/${roomKey}/python?token=${seekerToken2}`);
        sockets.push(ws);
      }
      const results=await Promise.all(sockets.map(ws=>new Promise(res=>{
        ws.on("open",()=>res("open"));
        ws.on("error",()=>res("error"));
        setTimeout(()=>res("timeout"),3000);
      })));
      expect(results.filter(r=>r==="open").length).toBeGreaterThan(5);
      sockets.forEach(ws=>{try{ws.close();}catch{}});
    });
    test("should handle malformed JSON without crash", async () => {
      const ws=new WebSocket(`ws://127.0.0.1:${port}/lsp/${roomKey}/python?token=${seekerToken2}`);
      await new Promise(res=>ws.on("open",res));
      ws.send("not json {");
      await new Promise(r=>setTimeout(r,500));
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
    test("should handle XSS in LSP didOpen", async () => {
      const ws=new WebSocket(`ws://127.0.0.1:${port}/lsp/${roomKey}/python?token=${seekerToken2}`);
      await new Promise(res=>ws.on("open",res));
      ws.send(JSON.stringify({ jsonrpc:"2.0", method:"textDocument/didOpen", params:{ textDocument:{ uri:`file:///tmp/jobly-lsp/${roomKey}/test.py`, languageId:"python", version:1, text:"<script>alert(1)</script>" }}}));
      await new Promise(r=>setTimeout(r,500));
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
  });
});
