const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const livekitService = require("../../src/infrastructure/webrtc/livekitService");

describe("Feature 10: LiveKit WebRTC Token & Permission Grants", () => {
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
      email: `seeker_lk_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_livekit",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_lk_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_livekit",
    });

    outsiderUser = await User.create({
      name: "Outsider User",
      email: `outsider_lk_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_livekit",
    });

    const jobDoc = await Job.create({
      title: "WebRTC Realtime Engineer",
      description: "Looking for video streaming expert.",
      company: "Realtime Corp",
      recruiter: recruiterUser._id,
      tenantId: "tenant_livekit",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_livekit",
    });

    roomKey = `room-lk-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_livekit",
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

  test("Test 1: should generate signed LiveKit JWT token with room grants", () => {
    const token = livekitService.generateLiveKitToken({
      roomKey: "test_room_123",
      participantIdentity: "user_456",
      participantName: "Alice Dev",
      canPublish: true,
      canSubscribe: true,
    });

    expect(token).toBeDefined();
    expect(typeof token).toBe("string");

    const decoded = jwt.decode(token);
    expect(decoded.sub).toBe("user_456");
    expect(decoded.video.room).toBe("test_room_123");
    expect(decoded.video.canPublish).toBe(true);
  });

  test("Test 2: should fetch signed token via REST endpoint for participant", async () => {
    const res = await request(app)
      .post(`/api/interviews/${sessionDoc._id}/livekit-token`)
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.roomKey).toBe(sessionDoc.roomKey);
    expect(res.body.serverUrl).toBeDefined();
  });

  test("Test 3: should reject unauthorized non-participant from requesting token", async () => {
    const res = await request(app)
      .post(`/api/interviews/${sessionDoc._id}/livekit-token`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
  });

  test("Test 4: should return 404 if interview session does not exist", async () => {
    const fakeId = "507f1f77bcf86cd799439011";
    const res = await request(app)
      .post(`/api/interviews/${fakeId}/livekit-token`)
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(res.status).toBe(404);
  });
});
