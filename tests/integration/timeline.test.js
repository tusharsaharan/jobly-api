const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const TimelineEvent = require("../../src/models/TimelineEvent");

describe("Feature 6: Unified Timeline REST API", () => {
  let seekerUser;
  let recruiterUser;
  let outsiderUser;
  let sessionDoc;
  let seekerToken;
  let recruiterToken;
  let outsiderToken;
  let roomKey;
  let testEvent1;
  let testEvent2;
  let testEvent3;

  beforeEach(async () => {
    seekerUser = await User.create({
      name: "Seeker Dev",
      email: `seeker_timeline_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_timeline",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_timeline_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_timeline",
    });

    outsiderUser = await User.create({
      name: "Outsider User",
      email: `outsider_timeline_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_timeline",
    });

    const jobDoc = await Job.create({
      title: "Distributed Systems Lead",
      description: "Looking for principal engineer.",
      company: "Scalable Systems",
      recruiter: recruiterUser._id,
      tenantId: "tenant_timeline",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_timeline",
    });

    roomKey = `room-timeline-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_timeline",
      application: appDoc._id,
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      roomKey,
      scheduledStart: new Date(),
    });

    seekerToken = jwt.sign(
      { id: seekerUser._id.toString(), userId: seekerUser._id.toString(), role: "seeker" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    recruiterToken = jwt.sign(
      { id: recruiterUser._id.toString(), userId: recruiterUser._id.toString(), role: "recruiter" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    outsiderToken = jwt.sign(
      { id: outsiderUser._id.toString(), userId: outsiderUser._id.toString(), role: "seeker" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    // Seed diverse chronological events
    testEvent1 = await TimelineEvent.create({
      session: sessionDoc._id,
      pipeline: "STAGE",
      eventType: "stage.transition",
      offsetMs: 1000,
      participant: recruiterUser._id,
      participantRole: "recruiter",
      payload: { stage: "CODING", text: "Stage transition to CODING" },
    });

    testEvent2 = await TimelineEvent.create({
      session: sessionDoc._id,
      pipeline: "CODING",
      eventType: "code.execution",
      offsetMs: 5000,
      participant: seekerUser._id,
      participantRole: "seeker",
      payload: {
        codeSnippet: "def quicksort(arr): return arr",
        text: "Executed quicksort solution",
        exitCode: 0,
        durationMs: 340,
      },
    });

    testEvent3 = await TimelineEvent.create({
      session: sessionDoc._id,
      pipeline: "COMMUNICATION",
      eventType: "transcript.segment",
      offsetMs: 10000,
      participant: seekerUser._id,
      participantRole: "seeker",
      payload: { text: "Candidate explained time complexity as O(N log N)" },
    });
  });

  test("Test 1: should fetch paginated chronological timeline events", async () => {
    const res = await request(app)
      .get(`/api/timeline/${sessionDoc._id}/events?limit=2`)
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(2);
    expect(res.body.total).toBe(3);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.events[0].offsetMs).toBeLessThanOrEqual(res.body.events[1].offsetMs);
  });

  test("Test 2: should filter timeline events by pipeline (CODING/STAGE/COMMUNICATION)", async () => {
    const res = await request(app)
      .get(`/api/timeline/${sessionDoc._id}/events?pipeline=CODING`)
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].pipeline).toBe("CODING");
    expect(res.body.events[0].eventType).toBe("code.execution");
  });

  test("Test 3: should filter timeline events by time window offsetMs range", async () => {
    const res = await request(app)
      .get(`/api/timeline/${sessionDoc._id}/events?from=4000&to=8000`)
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].offsetMs).toBe(5000);
  });

  test("Test 4: should retrieve event context window (before and after events)", async () => {
    const res = await request(app)
      .get(`/api/timeline/${sessionDoc._id}/events/${testEvent2._id}/context?window=1`)
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.targetEvent._id.toString()).toBe(testEvent2._id.toString());
    expect(res.body.before.length).toBe(1);
    expect(res.body.after.length).toBe(1);
    expect(res.body.before[0]._id.toString()).toBe(testEvent1._id.toString());
    expect(res.body.after[0]._id.toString()).toBe(testEvent3._id.toString());
  });

  test("Test 5: should perform full text search across transcript, code, and stages", async () => {
    const res = await request(app)
      .get(`/api/timeline/${sessionDoc._id}/search?q=quicksort`)
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.results[0].payload.codeSnippet).toContain("quicksort");
  });

  test("Test 6: should block unauthorized non-participants from accessing timeline", async () => {
    const res = await request(app)
      .get(`/api/timeline/${sessionDoc._id}/events`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
  });
});
