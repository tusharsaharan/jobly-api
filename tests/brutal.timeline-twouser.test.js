const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const config = require("../src/config/env");
const User = require("../src/models/User");
const Job = require("../src/models/Job");
const Application = require("../src/models/Application");
const InterviewSession = require("../src/models/InterviewSession");
const TimelineEvent = require("../src/models/TimelineEvent");
const WhiteboardSnapshot = require("../src/models/WhiteboardSnapshot");
const { getOrCreateRoomDoc, cleanupRoomDoc } = require("../src/infrastructure/realtime/yjsCoordinator");
const { createTestUser, createTestJob, getAuthToken } = require("./utils/helpers");

describe("Brutal Timeline + Two-User Interaction", () => {
  jest.setTimeout(60000);
  let seeker, recruiter, outsider, seekerToken, recruiterToken, outsiderToken, job, appDoc, session, roomKey;

  beforeEach(async () => {
    seeker = await createTestUser({ name: "Seeker Brutal", email: `s-${Date.now()}-${Math.random()}@ex.com`, role: "seeker", skills: ["js"], degree: "BTech", cgpa: 8 });
    recruiter = await createTestUser({ name: "Recruiter Brutal", email: `r-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    outsider = await createTestUser({ name: "Outsider", email: `o-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    seekerToken = getAuthToken(seeker);
    recruiterToken = getAuthToken(recruiter);
    outsiderToken = getAuthToken(outsider);
    job = await createTestJob(recruiter._id, { title: "Brutal Job", skills: ["js"] });
    appDoc = await Application.create({ job: job._id, seeker: seeker._id, recruiter: recruiter._id, status: "shortlisted", atsScore: 80 });
    roomKey = `room-brutal-${Date.now()}-${Math.random()}`;
    session = await InterviewSession.create({
      tenantId: "default",
      application: appDoc._id,
      job: job._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      roomKey,
      scheduledStart: new Date(),
      actualStart: new Date(Date.now() - 60000),
      status: "LIVE",
      stage: "CODING",
    });
    // Seed 3 events
    await TimelineEvent.create({ session: session._id, pipeline: "CODING", eventType: "code.execution", offsetMs: 1000, participant: seeker._id, participantRole: "seeker", payload: { text: "exec 1" } });
    await TimelineEvent.create({ session: session._id, pipeline: "COMMUNICATION", eventType: "transcript.segment", offsetMs: 2000, participant: seeker._id, payload: { text: "hello world" } });
    await TimelineEvent.create({ session: session._id, pipeline: "STAGE", eventType: "stage.transition", offsetMs: 3000, participant: recruiter._id, payload: { stage: "CODING" } });
  });

  afterEach(async () => {
    cleanupRoomDoc(roomKey);
  });

  describe("Timeline Brutal Chaos", () => {
    test("BRUTAL: concurrent 100 timeline writes from both users should all persist and be ordered", async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(TimelineEvent.create({ session: session._id, pipeline: "CODING", eventType: "code.execution", offsetMs: 5000 + i, participant: seeker._id, payload: { text: `seeker ${i}` } }));
        promises.push(TimelineEvent.create({ session: session._id, pipeline: "COMMUNICATION", eventType: "transcript.segment", offsetMs: 5000 + i, participant: recruiter._id, payload: { text: `recruiter ${i}` } }));
      }
      await Promise.all(promises);
      const res = await request(app).get(`/api/timeline/${session._id}/events?limit=200`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(103); // 3 seeded + 100
      // Check strict offset ordering
      for (let i = 1; i < res.body.events.length; i++) {
        expect(res.body.events[i].offsetMs).toBeGreaterThanOrEqual(res.body.events[i-1].offsetMs);
      }
    });

    test("BRUTAL: pagination with limit=1000000 should be capped and not crash", async () => {
      const res = await request(app).get(`/api/timeline/${session._id}/events?limit=1000000&offset=0`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      // Should not return 1M, should be capped to reasonable max (e.g., 100 or 200)
      expect(res.body.events.length).toBeLessThanOrEqual(200);
      expect(res.status).not.toBe(500);
    });

    test("BRUTAL: negative limit/offset and NaN should not crash", async () => {
      const cases = [
        `/api/timeline/${session._id}/events?limit=-10&offset=-5`,
        `/api/timeline/${session._id}/events?limit=abc&offset=xyz`,
        `/api/timeline/${session._id}/events?from=-9999&to=9999999999`,
        `/api/timeline/${session._id}/events?limit=0`,
      ];
      for (const url of cases) {
        const res = await request(app).get(url).set("Authorization", `Bearer ${recruiterToken}`);
        expect(res.status).not.toBe(500);
        expect([200,400]).toContain(res.status);
      }
    });

    test("BRUTAL: search with ReDoS regex should not hang or crash", async () => {
      const redosPayloads = [
        "(a+)+$",
        ".*a.*a.*a.*a.*a.*",
        "([a-z]+)+$",
        "q".repeat(5000),
        ".*".repeat(100),
        "quicksort)(.*",
      ];
      for (const q of redosPayloads) {
        const start = Date.now();
        const res = await request(app).get(`/api/timeline/${session._id}/search?q=${encodeURIComponent(q)}`).set("Authorization", `Bearer ${recruiterToken}`);
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(2000); // Must not hang
        expect(res.status).not.toBe(500);
        expect([200,400]).toContain(res.status);
      }
    });

    test("BRUTAL: search with empty q should return 400 not 500", async () => {
      const res = await request(app).get(`/api/timeline/${session._id}/search?q=`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(400);
      const res2 = await request(app).get(`/api/timeline/${session._id}/search`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res2.status).toBe(400);
    });

    test("BRUTAL: context window with huge window=100000 should be capped", async () => {
      const ev = await TimelineEvent.findOne({ session: session._id });
      const res = await request(app).get(`/api/timeline/${session._id}/events/${ev._id}/context?window=100000`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
      expect(res.status).toBe(200);
      expect(res.body.before.length).toBeLessThanOrEqual(100);
      expect(res.body.after.length).toBeLessThanOrEqual(100);
    });

    test("BRUTAL: timeline ordering with identical offsetMs should be deterministic by createdAt", async () => {
      const sameOffset = 7777;
      await TimelineEvent.create({ session: session._id, pipeline: "CODING", eventType: "code.execution", offsetMs: sameOffset, participant: seeker._id, payload: { text: "first" } });
      // slight delay to ensure createdAt differs
      await new Promise(r => setTimeout(r, 10));
      await TimelineEvent.create({ session: session._id, pipeline: "CODING", eventType: "code.execution", offsetMs: sameOffset, participant: seeker._id, payload: { text: "second" } });
      await new Promise(r => setTimeout(r, 10));
      await TimelineEvent.create({ session: session._id, pipeline: "CODING", eventType: "code.execution", offsetMs: sameOffset, participant: seeker._id, payload: { text: "third" } });
      const res = await request(app).get(`/api/timeline/${session._id}/events?from=7777&to=7777`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.events.length).toBe(3);
      // Should be ordered by createdAt asc when offset equal
      expect(res.body.events[0].payload.text).toBe("first");
      expect(res.body.events[2].payload.text).toBe("third");
    });

    test("BRUTAL: two users fetching timeline simultaneously with different pipelines should not leak", async () => {
      const [r1, r2] = await Promise.all([
        request(app).get(`/api/timeline/${session._id}/events?pipeline=CODING`).set("Authorization", `Bearer ${seekerToken}`),
        request(app).get(`/api/timeline/${session._id}/events?pipeline=COMMUNICATION`).set("Authorization", `Bearer ${recruiterToken}`),
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r1.body.events.every(e => e.pipeline === "CODING")).toBe(true);
      expect(r2.body.events.every(e => e.pipeline === "COMMUNICATION")).toBe(true);
    });
  });

  describe("Two-User Interaction Brutal", () => {
    test("BRUTAL: outsider cannot fetch timeline, events, context, or search", async () => {
      const ev = await TimelineEvent.findOne({ session: session._id });
      const urls = [
        `/api/timeline/${session._id}/events`,
        `/api/timeline/${session._id}/events/${ev._id}`,
        `/api/timeline/${session._id}/events/${ev._id}/context`,
        `/api/timeline/${session._id}/search?q=hello`,
      ];
      for (const url of urls) {
        const res = await request(app).get(url).set("Authorization", `Bearer ${outsiderToken}`);
        expect(res.status).toBe(403);
      }
    });

    test("BRUTAL: simultaneous whiteboard snapshot creation should have unique sequenceNumbers", async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(request(app).post(`/api/whiteboard/${session._id}/snapshots`).set("Authorization", `Bearer ${i % 2 === 0 ? seekerToken : recruiterToken}`).send({ canvasWidth: 1920 }));
      }
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(201));
      const seqs = results.map(r => r.body.snapshot.sequenceNumber).sort((a,b)=>a-b);
      // Check uniqueness
      const uniq = new Set(seqs);
      expect(uniq.size).toBe(10);
      expect(seqs).toEqual([1,2,3,4,5,6,7,8,9,10]);
    });

    test("BRUTAL: simultaneous file creation race at same path should give 201 and 409", async () => {
      const filePath = `/brutal-${Date.now()}.py`;
      const payload = { name: "brutal.py", path: filePath, language: "python", initialContent: "print(1)" };
      const [r1, r2] = await Promise.all([
        request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${seekerToken}`).send(payload),
        request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${recruiterToken}`).send(payload),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);
    });

    test("BRUTAL: concurrent code executions from both users should have monotonic sequenceNumbers", async () => {
      const promises = [];
      for (let i = 0; i < 20; i++) {
        const token = i % 2 === 0 ? seekerToken : recruiterToken;
        promises.push(request(app).post(`/api/interviews/${session._id}/execute`).set("Authorization", `Bearer ${token}`).send({ language: "python", code: `print(${i})` }));
      }
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
      const seqs = results.map(r => r.body.execution.sequence).sort((a,b)=>a-b);
      // Must be strictly increasing unique sequence
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBeGreaterThan(seqs[i-1]);
      }
      // Check no duplicates
      expect(new Set(seqs).size).toBe(20);
    });

    test("BRUTAL: seeker cannot change stage, recruiter can, under race", async () => {
      const [rSeeker, rRecruiter] = await Promise.all([
        request(app).patch(`/api/interviews/${session._id}/stage`).set("Authorization", `Bearer ${seekerToken}`).send({ stage: "SYSTEM_DESIGN" }),
        request(app).patch(`/api/interviews/${session._id}/stage`).set("Authorization", `Bearer ${recruiterToken}`).send({ stage: "CODING" }),
      ]);
      expect(rSeeker.status).toBe(403);
      expect([200,400]).toContain(rRecruiter.status);
    });

    test("BRUTAL: replay frame at various offsets should be consistent for both users", async () => {
      // Create timeline events at different offsets
      await TimelineEvent.create({ session: session._id, pipeline: "CODING", eventType: "code.execution", offsetMs: 10000, participant: seeker._id, payload: { text: "frame test" } });
      for (const offset of [0, 500, 1500, 2500, 10000, 999999]) {
        const [r1, r2] = await Promise.all([
          request(app).get(`/api/replay/${session._id}/frame?offsetMs=${offset}`).set("Authorization", `Bearer ${seekerToken}`),
          request(app).get(`/api/replay/${session._id}/frame?offsetMs=${offset}`).set("Authorization", `Bearer ${recruiterToken}`),
        ]);
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(r1.body.offsetMs).toBe(offset);
        expect(r2.body.offsetMs).toBe(offset);
        // Both users see same stage
        expect(r1.body.activeStage).toBe(r2.body.activeStage);
      }
      const outsiderRes = await request(app).get(`/api/replay/${session._id}/frame?offsetMs=1000`).set("Authorization", `Bearer ${outsiderToken}`);
      expect(outsiderRes.status).toBe(403);
    });

    test("BRUTAL: outsider cannot create whiteboard snapshot or coding file", async () => {
      const snapRes = await request(app).post(`/api/whiteboard/${session._id}/snapshots`).set("Authorization", `Bearer ${outsiderToken}`).send({});
      expect(snapRes.status).toBe(403);
      const fileRes = await request(app).post(`/api/coding/${session._id}/files`).set("Authorization", `Bearer ${outsiderToken}`).send({ name: "hack.py", path: "/hack.py" });
      expect(fileRes.status).toBe(403);
    });
  });
});
