const request = require("supertest");
const jwt = require("jsonwebtoken");
const Y = require("yjs");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const WhiteboardSnapshot = require("../../src/models/WhiteboardSnapshot");
const TimelineEvent = require("../../src/models/TimelineEvent");
const { getOrCreateWhiteboardDoc, cleanupRoomDoc } = require("../../src/infrastructure/realtime/yjsCoordinator");

describe("Feature 5: Whiteboard Synchronization & Snapshot System", () => {
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
      email: `seeker_wb_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_whiteboard",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_wb_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_whiteboard",
    });

    outsiderUser = await User.create({
      name: "Outsider User",
      email: `outsider_wb_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_whiteboard",
    });

    const jobDoc = await Job.create({
      title: "System Design Architect",
      description: "Looking for system design expert with microservices and high scalability experience.",
      company: "CloudScale Inc",
      recruiter: recruiterUser._id,
      tenantId: "tenant_whiteboard",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_whiteboard",
    });

    roomKey = `room-wb-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_whiteboard",
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

  test("Test 1: should mutate and query whiteboard objects in Yjs doc", async () => {
    const entry = await getOrCreateWhiteboardDoc(roomKey);
    const objectsMap = entry.doc.getMap("objects");

    entry.doc.transact(() => {
      objectsMap.set("rect_1", {
        id: "rect_1",
        type: "rectangle",
        x: 50,
        y: 100,
        width: 200,
        height: 120,
        color: "#2A9D7B",
      });
    });

    expect(objectsMap.get("rect_1")).toBeDefined();
    expect(objectsMap.get("rect_1").type).toBe("rectangle");
  });

  test("Test 2: should create an immutable snapshot of whiteboard canvas state", async () => {
    const entry = await getOrCreateWhiteboardDoc(roomKey);
    const objectsMap = entry.doc.getMap("objects");

    entry.doc.transact(() => {
      objectsMap.set("node_lb", {
        id: "node_lb",
        type: "stencil",
        stencilType: "load_balancer",
        x: 100,
        y: 100,
        width: 140,
        height: 60,
      });
    });

    const res = await request(app)
      .post(`/api/whiteboard/${sessionDoc._id}/snapshots`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({ canvasWidth: 1920, canvasHeight: 1080 });

    expect(res.status).toBe(201);
    expect(res.body.snapshot.sequenceNumber).toBe(1);
    expect(res.body.snapshot.objects.length).toBeGreaterThan(0);

    const event = await TimelineEvent.findOne({
      session: sessionDoc._id,
      eventType: "whiteboard.snapshot",
    });
    expect(event).not.toBeNull();
  });

  test("Test 3: should list all historical snapshots for an interview", async () => {
    await request(app)
      .post(`/api/whiteboard/${sessionDoc._id}/snapshots`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({});

    await request(app)
      .post(`/api/whiteboard/${sessionDoc._id}/snapshots`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({});

    const res = await request(app)
      .get(`/api/whiteboard/${sessionDoc._id}/snapshots`)
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.snapshots.length).toBe(2);
  });

  test("Test 4: should restore canvas to historical snapshot", async () => {
    const entry = await getOrCreateWhiteboardDoc(roomKey);
    const objectsMap = entry.doc.getMap("objects");

    // Snapshot 1
    entry.doc.transact(() => {
      objectsMap.set("state1_el", { id: "state1_el", type: "circle", x: 10, y: 10 });
    });

    const snapRes = await request(app)
      .post(`/api/whiteboard/${sessionDoc._id}/snapshots`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({});

    const snapId = snapRes.body.snapshot._id;

    // Mutate state
    entry.doc.transact(() => {
      objectsMap.clear();
      objectsMap.set("state2_corrupted", { id: "state2_corrupted", type: "rectangle" });
    });

    // Restore
    const restoreRes = await request(app)
      .post(`/api/whiteboard/${sessionDoc._id}/snapshots/${snapId}/restore`)
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(restoreRes.status).toBe(200);
    expect(objectsMap.get("state1_el")).toBeDefined();
    expect(objectsMap.get("state2_corrupted")).toBeUndefined();
  });

  test("Test 5: should reject non-participants from accessing whiteboard snapshots", async () => {
    const res = await request(app)
      .get(`/api/whiteboard/${sessionDoc._id}/snapshots`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
  });
});
