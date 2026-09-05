const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const TimelineEvent = require("../../src/models/TimelineEvent");
const CodeCheckpoint = require("../../src/models/CodeCheckpoint");
const WhiteboardSnapshot = require("../../src/models/WhiteboardSnapshot");

describe("Feature 8: Post-Interview Replay System", () => {
  let seekerUser;
  let recruiterUser;
  let outsiderUser;
  let sessionDoc;
  let seekerToken;
  let recruiterToken;
  let outsiderToken;
  let roomKey;

  beforeEach(async () => {
    seekerUser = await User.create({
      name: "Seeker Dev",
      email: `seeker_replay_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_replay",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_replay_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_replay",
    });

    outsiderUser = await User.create({
      name: "Outsider User",
      email: `outsider_replay_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_replay",
    });

    const jobDoc = await Job.create({
      title: "Senior Backend Architect",
      description: "Looking for principal engineer.",
      company: "Scalable Systems",
      recruiter: recruiterUser._id,
      tenantId: "tenant_replay",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_replay",
    });

    roomKey = `room-replay-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const actualStart = new Date(Date.now() - 3600000);
    const actualEnd = new Date();

    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_replay",
      application: appDoc._id,
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      roomKey,
      scheduledStart: actualStart,
      actualStart,
      actualEnd,
      status: "COMPLETED",
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
      { id: outsiderUser._id.toString(), userId: outsiderUser._id.toString(), role: "recruiter" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    // Seed events across timeline
    await TimelineEvent.create({
      session: sessionDoc._id,
      pipeline: "STAGE",
      eventType: "stage.transition",
      offsetMs: 5000,
      participant: recruiterUser._id,
      payload: { stage: "CODING" },
    });

    await TimelineEvent.create({
      session: sessionDoc._id,
      pipeline: "COMMUNICATION",
      eventType: "transcript.segment",
      offsetMs: 12000,
      participant: seekerUser._id,
      participantRole: "seeker",
      payload: { text: "Explaining dynamic programming approach." },
    });

    await CodeCheckpoint.create({
      session: sessionDoc._id,
      triggerType: "MANUAL",
      triggerLabel: "Initial Working Code",
      sequenceNumber: 1,
      filesSnapshot: [
        {
          path: "/solution.py",
          name: "solution.py",
          content: "def dp_solution(): return True",
          language: "python",
        },
      ],
    });

    await WhiteboardSnapshot.create({
      session: sessionDoc._id,
      sequenceNumber: 1,
      objects: [{ id: "arch_lb", type: "stencil", stencilType: "load_balancer" }],
    });
  });

  test("Test 1: should fetch complete replay manifest with duration and stage markers", async () => {
    const res = await request(app)
      .get(`/api/replay/${sessionDoc._id}/manifest`)
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalDurationMs).toBeGreaterThan(0);
    expect(res.body.eventCount).toBe(2);
    expect(res.body.stages.length).toBe(1);
    expect(res.body.stages[0].stage).toBe("CODING");
  });

  test("Test 2: should reconstruct exact unified interview frame at offsetMs", async () => {
    const res = await request(app)
      .get(`/api/replay/${sessionDoc._id}/frame?offsetMs=15000`)
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.activeStage).toBe("CODING");
    expect(res.body.codeWorkspace.files[0].content).toContain("dp_solution");
    expect(res.body.whiteboard.objects.length).toBe(1);
    expect(res.body.transcriptHistory.length).toBe(1);
    expect(res.body.transcriptHistory[0].text).toContain("dynamic programming");
  });

  test("Test 3: should return initial defaults when offsetMs precedes all events", async () => {
    const res = await request(app)
      .get(`/api/replay/${sessionDoc._id}/frame?offsetMs=0`)
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.activeStage).toBe("WAITING_ROOM");
    expect(res.body.transcriptHistory.length).toBe(0);
  });

  test("Test 4: should reject unauthorized non-participants from loading replay", async () => {
    const res = await request(app)
      .get(`/api/replay/${sessionDoc._id}/manifest`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
  });

  test("Test 5: should return 404 for invalid non-existent session ID", async () => {
    const fakeId = "507f1f77bcf86cd799439011";
    const res = await request(app)
      .get(`/api/replay/${fakeId}/manifest`)
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(res.status).toBe(404);
  });
});
