const WebSocket = require("ws");
const http = require("http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Y = require("yjs");
const syncProtocol = require("y-protocols/dist/sync.cjs");
const encoding = require("lib0/dist/encoding.cjs");

const app = require("../../src/app");
const { setupSocketIO } = require("../../src/infrastructure/realtime/socketio");
const { handleUpgrade } = require("../../src/infrastructure/realtime/yjsWebSocket");
const {
  getOrCreateRoomDoc,
  cleanupRoomDoc,
  roomDocs,
} = require("../../src/infrastructure/realtime/yjsCoordinator");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");

const config = require("../../src/config/env");

describe("Feature 1: Yjs WebSocket Collaboration Endpoint", () => {
  let server;
  let port;
  let seekerUser;
  let recruiterUser;
  let outsiderUser;
  let sessionDoc;
  let validToken;
  let outsiderToken;
  let roomKey;

  beforeAll(async () => {
    // Setup test HTTP server with Yjs upgrade handling
    server = http.createServer(app);
    setupSocketIO(server);

    const originalUpgradeListeners = server.listeners("upgrade").slice();
    server.removeAllListeners("upgrade");

    server.on("upgrade", async (req, socket, head) => {
      const pathname = req.url ? req.url.split("?")[0] : "";
      if (pathname.startsWith("/collab/") || pathname.startsWith("/whiteboard/")) {
        const handled = await handleUpgrade(req, socket, head);
        if (handled !== false) return;
      }
      for (const listener of originalUpgradeListeners) {
        listener(req, socket, head);
      }
    });

    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  beforeEach(async () => {
    seekerUser = await User.create({
      name: "Seeker Dev",
      email: `seeker_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_yjs",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_yjs",
    });

    outsiderUser = await User.create({
      name: "Outsider NonParticipant",
      email: `outsider_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_yjs",
    });

    const jobDoc = await Job.create({
      title: "Senior Backend Engineer",
      description: "We are looking for a senior backend engineer with deep Node.js and distributed systems skills.",
      company: "Tech Corp",
      recruiter: recruiterUser._id,
      tenantId: "tenant_yjs",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_yjs",
    });

    roomKey = `room-yjs-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_yjs",
      application: appDoc._id,
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      roomKey,
      scheduledStart: new Date(),
    });

    validToken = jwt.sign(
      { id: seekerUser._id.toString(), userId: seekerUser._id.toString(), role: "seeker" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    outsiderToken = jwt.sign(
      { id: outsiderUser._id.toString(), userId: outsiderUser._id.toString(), role: "seeker" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );
  });

  afterAll(async () => {
    cleanupRoomDoc(roomKey);
    await new Promise((resolve) => server.close(resolve));
  });

  test("Test 1: should reject connection when token is invalid or missing", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab/${roomKey}?token=invalid_token`);
    const errorOccurred = await new Promise((resolve) => {
      ws.on("error", () => resolve(true));
      ws.on("close", (code) => resolve(code !== 1000));
      ws.on("open", () => resolve(false));
    });
    expect(errorOccurred).toBe(true);
  });

  test("Test 2: should reject connection if user is not a registered participant", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab/${roomKey}?token=${outsiderToken}`);
    const rejected = await new Promise((resolve) => {
      ws.on("error", () => resolve(true));
      ws.on("close", () => resolve(true));
      ws.on("open", () => resolve(false));
    });
    expect(rejected).toBe(true);
  });

  test("Test 3: should connect authenticated participant and receive initial sync step 1", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab/${roomKey}?token=${validToken}`);
    
    const receivedMessagePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout waiting for sync step 1")), 3000);
      ws.on("message", (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const receivedMessage = await receivedMessagePromise;
    expect(receivedMessage).toBeDefined();
    expect(Buffer.isBuffer(receivedMessage) || receivedMessage instanceof Uint8Array).toBe(true);
    ws.close();
  });

  test("Test 4: should synchronize CRDT document updates between two connected clients", async () => {
    const recruiterToken = jwt.sign(
      { id: recruiterUser._id.toString(), userId: recruiterUser._id.toString(), role: "recruiter" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/collab/${roomKey}?token=${validToken}`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/collab/${roomKey}?token=${recruiterToken}`);

    await Promise.all([
      new Promise((res) => ws1.on("open", res)),
      new Promise((res) => ws2.on("open", res)),
    ]);

    // Client 1 sends a Yjs update modifying /solution.py
    const localDoc1 = new Y.Doc();
    const ytext1 = localDoc1.getText("/solution.py");
    ytext1.insert(0, "def test_sync(): return 42\n");
    const update1 = Y.encodeStateAsUpdate(localDoc1);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
    syncProtocol.writeUpdate(encoder, update1);
    const packet = Buffer.from(encoding.toUint8Array(encoder));

    // ws2 listens for incoming sync update
    const receivedUpdatePromise = new Promise((resolve) => {
      ws2.on("message", (data) => {
        resolve(data);
      });
    });

    ws1.send(packet);

    const updateReceived = await receivedUpdatePromise;
    expect(updateReceived).toBeDefined();

    ws1.close();
    ws2.close();
  });

  test("Test 5: should persist Yjs state to MongoDB on update", async () => {
    const { persistRoomDocNow } = require("../../src/infrastructure/realtime/yjsCoordinator");
    const entry = await getOrCreateRoomDoc(roomKey);
    const ytext = entry.doc.getText("/solution.py");
    
    entry.doc.transact(() => {
      ytext.insert(0, "\n# Persisted state test line\n");
    });

    await persistRoomDocNow(roomKey, entry.doc, "yjsState");

    const updatedSession = await InterviewSession.findOne({ roomKey });
    expect(updatedSession).not.toBeNull();
    expect(updatedSession.yjsState).toBeDefined();
    expect(Buffer.isBuffer(updatedSession.yjsState)).toBe(true);
    expect(updatedSession.yjsState.length).toBeGreaterThan(0);
  });
});
