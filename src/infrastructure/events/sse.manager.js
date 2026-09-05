const logger = require("../../config/logger");

class SseManager {
  constructor() {
    // Map<userId, Set<Response>>
    this.clients = new Map();
  }

  addClient(userId, res) {
    const userKey = String(userId);
    if (!this.clients.has(userKey)) {
      this.clients.set(userKey, new Set());
    }
    this.clients.get(userKey).add(res);

    logger.debug({ userId: userKey }, "SSE client connected");

    // Heartbeat every 15s to keep proxy connections alive
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 15000);

    res.on("close", () => {
      clearInterval(heartbeat);
      const set = this.clients.get(userKey);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          this.clients.delete(userKey);
        }
      }
      logger.debug({ userId: userKey }, "SSE client disconnected");
    });
  }

  sendToUser(userId, event, data) {
    const userKey = String(userId);
    const set = this.clients.get(userKey);
    if (!set || set.size === 0) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch (err) {
        logger.error({ err: err.message, userId: userKey }, "Failed writing SSE payload");
      }
    }
  }

  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [, set] of this.clients) {
      for (const res of set) {
        try {
          res.write(payload);
        } catch (err) {
          // ignore closed socket
        }
      }
    }
  }
}

const sseManager = new SseManager();

module.exports = sseManager;
