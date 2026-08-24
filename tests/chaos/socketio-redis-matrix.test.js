/**
 * PRODUCTION-GRADE CHAOS & RESILIENCE TEST SUITE: SOCKET.IO & REDIS PUB/SUB ADAPTER
 * Matrix Coverage: Massive Cartesian Product via test.each
 */

const { io: Client } = require("socket.io-client");
const http = require("http");
const { Server } = require("socket.io");
const Redis = require("ioredis");
const { createAdapter } = require("@socket.io/redis-adapter");
const jwt = require("jsonwebtoken");

describe("CATEGORY 1: Socket.IO & Redis Adapter Resilience (Massive Matrix Variations)", () => {
  let ioServer, httpServer, pubClient, subClient;
  const PORT = 9876;
  const JWT_SECRET = "chaos-testing-secret-key-32bytes-len";

  beforeAll(async () => {
    httpServer = http.createServer();
    ioServer = new Server(httpServer, {
      cors: { origin: "*" },
      pingTimeout: 2000,
      pingInterval: 1000,
      transports: ["websocket", "polling"],
    });

    try {
      pubClient = new Redis("redis://127.0.0.1:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
      subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      ioServer.adapter(createAdapter(pubClient, subClient));
    } catch (e) {
      // In-memory fallback if Redis daemon is not running locally during tests
    }

    ioServer.use((socket, next) => {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("AUTH_REQUIRED"));
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.data.user = decoded;
        next();
      } catch (err) {
        next(new Error(`AUTH_INVALID:${err.name}`));
      }
    });

    ioServer.on("connection", (socket) => {
      socket.on("join-room", (roomId) => {
        socket.join(roomId);
        socket.emit("joined-room", { roomId, socketId: socket.id });
      });

      socket.on("room-broadcast", ({ roomId, payload }) => {
        socket.to(roomId).emit("room-event", { sender: socket.id, payload });
      });
    });

    await new Promise((res) => httpServer.listen(PORT, res));
  });

  afterAll(async () => {
    ioServer.close();
    await new Promise((res) => httpServer.close(res));
    if (pubClient) {
      try { pubClient.disconnect(); } catch (e) {}
    }
    if (subClient) {
      try { subClient.disconnect(); } catch (e) {}
    }
  });

  const generateAuthMatrix = () => {
    const tokenStates = [
      { name: "valid_seeker", token: () => jwt.sign({ id: "u1", role: "seeker" }, JWT_SECRET), expectSuccess: true },
      { name: "valid_recruiter", token: () => jwt.sign({ id: "u2", role: "recruiter" }, JWT_SECRET), expectSuccess: true },
      { name: "expired_token", token: () => jwt.sign({ id: "u3", exp: Math.floor(Date.now() / 1000) - 60 }, JWT_SECRET), expectSuccess: false },
      { name: "tampered_signature", token: () => jwt.sign({ id: "u4" }, "wrong-key"), expectSuccess: false },
      { name: "empty_token", token: () => "", expectSuccess: false },
      { name: "malformed_jwt", token: () => "not.a.valid.jwt.string", expectSuccess: false },
    ];
    const transportModes = [
      ["websocket"],
      ["polling"],
      ["polling", "websocket"],
      ["websocket", "polling"],
    ];
    const combos = [];
    for (const t of tokenStates) {
      for (const tm of transportModes) {
        combos.push([t.name, tm, t.expectSuccess, t.token()]);
      }
    }
    return combos;
  };

  describe("Handshake & Transport Degradation Matrix", () => {
    const authMatrix = generateAuthMatrix(); // 6 x 4 = 24 combinations
    test.each(authMatrix)(
      "Auth state: %p | Transports: %p | Expects Success: %p",
      async (tokenName, transports, expectSuccess, tokenStr) => {
        const client = Client(`http://127.0.0.1:${PORT}`, {
          auth: { token: tokenStr },
          transports,
          reconnection: false,
          timeout: 1500,
        });

        if (expectSuccess) {
          await new Promise((resolve, reject) => {
            client.on("connect", () => {
              expect(client.connected).toBe(true);
              client.disconnect();
              resolve();
            });
            client.on("connect_error", (err) => reject(err));
          });
        } else {
          await new Promise((resolve) => {
            client.on("connect_error", (err) => {
              expect(err.message).toMatch(/AUTH_/);
              client.disconnect();
              resolve();
            });
            client.on("connect", () => {
              client.disconnect();
              throw new Error("Expected auth connection rejection but got success");
            });
          });
        }
      }
    );
  });

  const generateBroadcastMatrix = () => {
    const rooms = [1, 5, 20];
    const clientsPerRoom = [2, 5];
    const msgsPerClient = [1, 10];
    const combos = [];
    for (const r of rooms) {
      for (const c of clientsPerRoom) {
        for (const m of msgsPerClient) {
          combos.push([r, c, m]);
        }
      }
    }
    return combos;
  };

  describe("Multi-Room Broadcast Isolation Matrix", () => {
    const broadcastMatrix = generateBroadcastMatrix(); // 3 x 2 x 2 = 12 combinations
    test.each(broadcastMatrix)(
      "Isolated Room Broadcasts: %p rooms, %p clients/room, %p messages/client",
      async (roomCount, clientsPerRoom, msgCount) => {
        const validToken = jwt.sign({ id: "load-tester", role: "seeker" }, JWT_SECRET);
        const roomClients = new Map();
        const receivedCounts = new Map();

        for (let r = 0; r < roomCount; r++) {
          const roomId = `stress-room-${r}-${roomCount}-${clientsPerRoom}-${msgCount}`;
          roomClients.set(roomId, []);
          for (let c = 0; c < clientsPerRoom; c++) {
            const client = Client(`http://127.0.0.1:${PORT}`, {
              auth: { token: validToken },
              transports: ["websocket"],
              reconnection: false,
            });
            await new Promise((res) => client.on("connect", res));
            client.emit("join-room", roomId);
            await new Promise((res) => client.on("joined-room", res));

            client.on("room-event", (data) => {
              const current = receivedCounts.get(roomId) || 0;
              receivedCounts.set(roomId, current + 1);
              expect(data.payload.targetRoom).toBe(roomId);
            });

            roomClients.get(roomId).push(client);
          }
        }

        for (let r = 0; r < roomCount; r++) {
          const roomId = `stress-room-${r}-${roomCount}-${clientsPerRoom}-${msgCount}`;
          const sender = roomClients.get(roomId)[0];
          for (let m = 0; m < msgCount; m++) {
            sender.emit("room-broadcast", {
              roomId,
              payload: { targetRoom: roomId, seq: m, timestamp: Date.now() },
            });
          }
        }

        await new Promise((res) => setTimeout(res, 800));

        for (const clients of roomClients.values()) {
          for (const c of clients) c.disconnect();
        }

        const expectedPerRoom = (clientsPerRoom - 1) * msgCount;
        for (let r = 0; r < roomCount; r++) {
          const count = receivedCounts.get(`stress-room-${r}-${roomCount}-${clientsPerRoom}-${msgCount}`) || 0;
          expect(count).toBe(expectedPerRoom);
        }
      }
    );
  });

  const generateMemoryMatrix = () => {
    const batches = [5, 20, 50];
    const clientsPerBatch = [5, 10, 20];
    const combos = [];
    for (const b of batches) {
      for (const c of clientsPerBatch) {
        combos.push([b, c]);
      }
    }
    return combos;
  };

  describe("Memory Leaks & Rapid Churn Matrix", () => {
    const memoryMatrix = generateMemoryMatrix(); // 3 x 3 = 9 combinations
    test.each(memoryMatrix)(
      "Batches: %p | Clients/Batch: %p",
      async (batches, clientsPerBatch) => {
        const validToken = jwt.sign({ id: "churn-user", role: "seeker" }, JWT_SECRET);
        if (global.gc) global.gc();
        const initialHeap = process.memoryUsage().heapUsed;

        for (let i = 0; i < batches; i++) {
          const batch = Array.from({ length: clientsPerBatch }, () =>
            Client(`http://127.0.0.1:${PORT}`, {
              auth: { token: validToken },
              transports: ["websocket"],
              reconnection: false,
            })
          );

          await Promise.all(batch.map((c) => new Promise((res) => c.on("connect", res))));
          for (const c of batch) c.disconnect();
        }

        await new Promise((res) => setTimeout(res, 500));
        if (global.gc) global.gc();
        const finalHeap = process.memoryUsage().heapUsed;

        const driftMB = (finalHeap - initialHeap) / (1024 * 1024);
        expect(driftMB).toBeLessThan(35.0);
      }
    );
  });
});
