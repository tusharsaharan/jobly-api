const request = require("supertest");
const app = require("../../src/app");
const { register } = require("../../src/infrastructure/observability/metrics");

describe("Observability & System Diagnostics", () => {
  describe("GET /api/health", () => {
    it("should return comprehensive health check with status of MongoDB, Redis, and Storage", async () => {
      const res = await request(app).get("/api/health");
      expect([200, 207]).toContain(res.statusCode);
      expect(res.body).toBeDefined();
      expect(res.body.status).toBeDefined();
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
      expect(res.body.checks).toBeDefined();
      expect(res.body.checks.mongodb).toBeDefined();
      expect(res.body.checks.redis).toBeDefined();
      expect(res.body.checks.storage).toBeDefined();
    });
  });

  describe("GET /api/metrics", () => {
    it("should export Prometheus metrics in standard text format", async () => {
      const res = await request(app).get("/api/metrics");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.text).toContain("jobly_uptime_seconds");
      expect(res.text).toContain("http_requests_total");
    });
  });

  describe("Tracing & Correlation ID Middleware", () => {
    it("should attach an x-request-id header to every incoming HTTP request", async () => {
      const res = await request(app).get("/api/health");
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(res.headers["x-request-id"].length).toBeGreaterThan(10);
    });

    it("should propagate incoming x-request-id if provided by API Gateway / Load Balancer", async () => {
      const customId = "trace-uuid-abcdef-123456";
      const res = await request(app)
        .get("/api/health")
        .set("x-request-id", customId);
      expect(res.headers["x-request-id"]).toBe(customId);
    });
  });
});
