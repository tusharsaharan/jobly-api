const sseManager = require("../../src/infrastructure/events/sse.manager");
const { publishDomainEvent, STREAM_NAME } = require("../../src/infrastructure/events/domainEvents");
const { emitToUser, emitToConversation } = require("../../src/infrastructure/realtime/socketio");

describe("Real-Time & Event Subsystems", () => {
  describe("SSE Manager", () => {
    it("should manage client connections and write formatted event payload", (done) => {
      const userId = "test-user-123";
      const writtenChunks = [];

      const mockRes = {
        write: (chunk) => {
          writtenChunks.push(chunk);
          if (chunk.includes("test_event")) {
            expect(chunk).toContain("event: test_event");
            expect(chunk).toContain('"progress":50');
            done();
          }
        },
        on: (event, cb) => {},
      };

      sseManager.addClient(userId, mockRes);
      sseManager.sendToUser(userId, "test_event", { progress: 50 });
    });

    it("should broadcast to all connected clients", (done) => {
      let broadcastReceived = 0;
      const mockRes1 = {
        write: (chunk) => {
          if (chunk.includes("system_alert")) broadcastReceived++;
          if (broadcastReceived === 2) done();
        },
        on: () => {},
      };
      const mockRes2 = {
        write: (chunk) => {
          if (chunk.includes("system_alert")) broadcastReceived++;
          if (broadcastReceived === 2) done();
        },
        on: () => {},
      };

      sseManager.addClient("user-a", mockRes1);
      sseManager.addClient("user-b", mockRes2);
      sseManager.broadcast("system_alert", { message: "Maintenance scheduled" });
    });
  });

  describe("Domain Event Publisher", () => {
    it("should publish domain events safely without crashing when Redis is disconnected", async () => {
      await expect(
        publishDomainEvent("test.event", { key: "value" })
      ).resolves.not.toThrow();
    });
  });

  describe("Socket.IO Emitter Helpers", () => {
    it("should safely handle emit calls even when socket server is not yet initialized", () => {
      expect(() => emitToUser("user-1", "ping", {})).not.toThrow();
      expect(() => emitToConversation("app-1", "message", {})).not.toThrow();
    });
  });
});
