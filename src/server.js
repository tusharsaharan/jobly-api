require("dotenv").config();
const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const config = require("./config/env");
const logger = require("./config/logger");
const { setupSocketIO } = require("./infrastructure/realtime/socketio");
const { redis } = require("./config/redis");
const mongoose = require("mongoose");

const PORT = config.PORT || 5000;

async function bootstrap() {
  await connectDB();

  const server = http.createServer(app);
  setupSocketIO(server);

  // ─── Yjs WebSocket upgrade handler ───────────────────────────────────────
  // Must be attached AFTER Socket.IO setup so Socket.IO's own upgrade
  // handling is registered first, but we intercept /collab/ and /whiteboard/
  // BEFORE Socket.IO sees them.
  const { handleUpgrade: yjsUpgrade } = require("./infrastructure/realtime/yjsWebSocket");
  const { handleLspUpgrade } = require("./infrastructure/lsp/lspGateway");

  // Intercept HTTP upgrade events for Yjs collab and LSP paths
  const originalUpgradeListeners = server.listeners("upgrade").slice();
  server.removeAllListeners("upgrade");

  server.on("upgrade", async (req, socket, head) => {
    const pathname = req.url ? req.url.split("?")[0] : "";
    // Handle Yjs routes first
    if (pathname.startsWith("/collab/") || pathname.startsWith("/whiteboard/")) {
      const handled = await yjsUpgrade(req, socket, head);
      if (handled !== false) return;
    }
    // Handle LSP WebSocket routes
    if (pathname.startsWith("/lsp/")) {
      const handled = await handleLspUpgrade(req, socket, head);
      if (handled !== false) return;
    }
    // Fall through to Socket.IO and any other upgrade handlers
    for (const listener of originalUpgradeListeners) {
      listener(req, socket, head);
    }
  });

  server.listen(PORT, () => {
    logger.info(`🚀 Jobly Production API running on port ${PORT} [Env: ${config.NODE_ENV}]`);
  });

  // Graceful Shutdown (Production SRE pattern)
  const shutdown = async (signal) => {
    logger.info({ signal }, "Received shutdown signal, closing HTTP and database connections...");
    server.close(async () => {
      logger.info("HTTP server closed.");
      try {
        if (redis && redis.status === "ready") {
          await redis.quit();
          logger.info("Redis connection closed.");
        }
        await mongoose.connection.close(false);
        logger.info("MongoDB connection closed.");
        process.exit(0);
      } catch (err) {
        logger.error({ err: err.message }, "Error during graceful shutdown");
        process.exit(1);
      }
    });

    // Force close after 10s timeout
    setTimeout(() => {
      logger.error("Forced shutdown after 10s timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  logger.error({ err: err.message }, "Server bootstrap failed");
  process.exit(1);
});
