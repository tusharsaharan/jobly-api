const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const TimelineEvent = require("../../src/models/TimelineEvent");
const { cleanupRoomDoc } = require("../../src/infrastructure/realtime/yjsCoordinator");

describe("Feature 2: Multi-File Workspace with File Explorer", () => {
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
      email: `seeker_coding_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_coding",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_coding_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_coding",
    });

    outsiderUser = await User.create({
      name: "Outsider User",
      email: `outsider_coding_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_coding",
    });

    const jobDoc = await Job.create({
      title: "Full Stack Engineer",
      description: "Looking for senior full stack engineer with Node and React experience.",
      company: "InnovateTech",
      recruiter: recruiterUser._id,
      tenantId: "tenant_coding",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_coding",
    });

    roomKey = `room-coding-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_coding",
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

  test("Test 1: should create a new file and record timeline event", async () => {
    const res = await request(app)
      .post(`/api/coding/${sessionDoc._id}/files`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({
        name: "utils.py",
        path: "/utils.py",
        language: "python",
        initialContent: "def helper(): return True\n",
      });

    expect(res.status).toBe(201);
    expect(res.body.file.path).toBe("/utils.py");

    const event = await TimelineEvent.findOne({
      session: sessionDoc._id,
      eventType: "file.created",
    });
    expect(event).not.toBeNull();
    expect(event.payload.file).toBe("/utils.py");
  });

  test("Test 2: should delete an existing file and record timeline event", async () => {
    // Create first
    await request(app)
      .post(`/api/coding/${sessionDoc._id}/files`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({ name: "temp.py", path: "/temp.py", language: "python" });

    // Delete
    const res = await request(app)
      .delete(`/api/coding/${sessionDoc._id}/files`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({ path: "/temp.py" });

    expect(res.status).toBe(200);
    expect(res.body.path).toBe("/temp.py");

    const event = await TimelineEvent.findOne({
      session: sessionDoc._id,
      eventType: "file.deleted",
    });
    expect(event).not.toBeNull();
  });

  test("Test 3: should rename/move a file and preserve content", async () => {
    // Create file
    await request(app)
      .post(`/api/coding/${sessionDoc._id}/files`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({
        name: "old.py",
        path: "/old.py",
        language: "python",
        initialContent: "# preserved text",
      });

    // Rename
    const res = await request(app)
      .put(`/api/coding/${sessionDoc._id}/files/rename`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({
        oldPath: "/old.py",
        newPath: "/new.py",
        newName: "new.py",
      });

    expect(res.status).toBe(200);

    // Verify workspace
    const wsRes = await request(app)
      .get(`/api/coding/${sessionDoc._id}/workspace`)
      .set("Authorization", `Bearer ${seekerToken}`);

    const paths = wsRes.body.workspace.map((f) => f.path);
    expect(paths).toContain("/new.py");
    expect(paths).not.toContain("/old.py");
  });

  test("Test 4: should create directories and retrieve full workspace hierarchy", async () => {
    await request(app)
      .post(`/api/coding/${sessionDoc._id}/directories`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({ path: "/src" });

    await request(app)
      .post(`/api/coding/${sessionDoc._id}/files`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({ name: "index.js", path: "/src/index.js", language: "javascript" });

    const res = await request(app)
      .get(`/api/coding/${sessionDoc._id}/workspace`)
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(res.status).toBe(200);
    expect(res.body.workspace).toBeInstanceOf(Array);
    const paths = res.body.workspace.map((f) => f.path);
    expect(paths).toContain("/src");
    expect(paths).toContain("/src/index.js");
  });

  test("Test 5: should block non-participant from modifying collaborative files", async () => {
    const res = await request(app)
      .post(`/api/coding/${sessionDoc._id}/files`)
      .set("Authorization", `Bearer ${outsiderToken}`)
      .send({ name: "hack.py", path: "/hack.py", language: "python" });

    expect(res.status).toBe(403);
  });
});
