const request = require("supertest");
const app = require("../../src/app");
const { telemetry } = require("../../src/infrastructure/telemetry/telemetry");

describe("Feature 16: Observability, Metrics & Telemetry", () => {
  beforeEach(() => {
    telemetry.reset();
  });

  test("Test 1: should record counter and gauge values in Prometheus registry", () => {
    telemetry.incrementCounter("interview_sessions_active", { stage: "CODING" });
    telemetry.setGauge("yjs_connected_peers", 5, { roomKey: "room-123" });

    const formatted = telemetry.toPrometheusFormat();
    expect(formatted).toContain('interview_sessions_active{stage="CODING"} 1');
    expect(formatted).toContain('yjs_connected_peers{roomKey="room-123"} 5');
  });

  test("Test 2: should record histogram samples and calculate count, sum, and average", () => {
    telemetry.recordHistogram("sandbox_execution_duration_ms", 100, { lang: "python" });
    telemetry.recordHistogram("sandbox_execution_duration_ms", 300, { lang: "python" });

    const formatted = telemetry.toPrometheusFormat();
    expect(formatted).toContain('sandbox_execution_duration_ms{lang="python"}_count 2');
    expect(formatted).toContain('sandbox_execution_duration_ms{lang="python"}_sum 400');
    expect(formatted).toContain('sandbox_execution_duration_ms{lang="python"}_avg 200.00');
  });

  test("Test 3: should expose /api/metrics endpoint with Prometheus formatted output", async () => {
    const res = await request(app).get("/api/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("jobly_uptime_seconds");
  });

  test("Test 4: should automatically record incoming HTTP requests via metricsMiddleware", async () => {
    await request(app).get("/api/health");

    const formatted = telemetry.toPrometheusFormat();
    expect(formatted).toContain("http_requests_total");
  });
});
