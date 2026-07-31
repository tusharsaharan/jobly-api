const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const CodeCheckpoint = require("../../src/models/CodeCheckpoint");
const TimelineEvent = require("../../src/models/TimelineEvent");
const checkpointService = require("../../src/services/checkpointService");
const { getOrCreateRoomDoc, cleanupRoomDoc } = require("../../src/infrastructure/realtime/yjsCoordinator");

describe("Feature 4: Code Checkpoint & Time-Travel Service", () => {
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
      email: `seeker_cp_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_checkpoint",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_cp_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_checkpoint",
    });

    outsiderUser = await User.create({
      name: "Outsider NonParticipant",
      email: `outsider_cp_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_checkpoint",
    });

    const jobDoc = await Job.create({
      title: "Senior Algorithm Engineer",
      description: "Looking for expert in algorithms and data structures.",
      company: "DataCorp",
      recruiter: recruiterUser._id,
      tenantId: "tenant_checkpoint",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_checkpoint",
    });

    roomKey = `room-cp-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_checkpoint",
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
  });

  afterAll(async () => {
    cleanupRoomDoc(roomKey);
  });

  test("Test 1: should create an immutable checkpoint from active Yjs doc", async () => {
    const entry = await getOrCreateRoomDoc(roomKey);
    entry.doc.getText("/solution.py").insert(0, "def solve(): return 100\n");

    const checkpoint = await checkpointService.createCheckpoint(
      sessionDoc,
      "MANUAL",
      "Manual test snapshot"
    );

    expect(checkpoint).toBeDefined();
    expect(checkpoint.sequenceNumber).toBe(1);
    expect(checkpoint.triggerType).toBe("MANUAL");
    expect(checkpoint.filesSnapshot.length).toBeGreaterThan(0);
    expect(checkpoint.filesSnapshot[0].content).toContain("def solve(): return 100");

    const event = await TimelineEvent.findOne({
      session: sessionDoc._id,
      eventType: "code.checkpoint",
    });
    expect(event).not.toBeNull();
  });

  test("Test 2: should increment sequence numbers monotonically on successive checkpoints", async () => {
    const cp1 = await checkpointService.createCheckpoint(sessionDoc, "AUTO_SAVE", "Auto 1");
    const cp2 = await checkpointService.createCheckpoint(sessionDoc, "AUTO_SAVE", "Auto 2");
    const cp3 = await checkpointService.createCheckpoint(sessionDoc, "EXECUTION", "Exec 1");

    expect(cp1.sequenceNumber).toBe(1);
    expect(cp2.sequenceNumber).toBe(2);
    expect(cp3.sequenceNumber).toBe(3);
  });

  test("Test 3: should restore workspace files and content back to a historical checkpoint", async () => {
    const entry = await getOrCreateRoomDoc(roomKey);
    const ytext = entry.doc.getText("/solution.py");

    // Initial state
    entry.doc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "INITIAL_CODE_STATE\n");
    });

    const checkpoint1 = await checkpointService.createCheckpoint(
      sessionDoc,
      "MANUAL",
      "State 1"
    );

    // Modify state
    entry.doc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, "MODIFIED_CODE_STATE_CORRUPTED\n");
    });
    expect(entry.doc.getText("/solution.py").toString()).toContain("MODIFIED_CODE_STATE");

    // Restore back to State 1
    const restored = await checkpointService.restoreCheckpoint(sessionDoc, checkpoint1._id);
    expect(restored.sequenceNumber).toBe(checkpoint1.sequenceNumber);
    expect(entry.doc.getText("/solution.py").toString()).toBe("INITIAL_CODE_STATE\n");
  });

  test("Test 4: should list checkpoints and trigger manual snapshots via REST API", async () => {
    // Create via REST
    const postRes = await request(app)
      .post(`/api/coding/${sessionDoc._id}/checkpoints`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({ label: "API Snapshot Test" });

    expect(postRes.status).toBe(201);
    expect(postRes.body.checkpoint.triggerLabel).toBe("API Snapshot Test");

    // List via REST
    const listRes = await request(app)
      .get(`/api/coding/${sessionDoc._id}/checkpoints`)
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.checkpoints).toBeInstanceOf(Array);
    expect(listRes.body.checkpoints.length).toBeGreaterThan(0);
  });

  test("Test 5: should block non-participants from accessing checkpoint endpoints", async () => {
    const res = await request(app)
      .get(`/api/coding/${sessionDoc._id}/checkpoints`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
  });
});
