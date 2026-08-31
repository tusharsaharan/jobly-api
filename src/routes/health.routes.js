const express = require("express");
const { checkHealth } = require("../controllers/health.controller");
const { telemetry } = require("../infrastructure/telemetry/telemetry");

const router = express.Router();

router.get("/health", checkHealth);
// Metrics exposed for Prometheus; in production restrict via NetworkPolicy / reverse proxy ACL, not app auth
router.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", "text/plain; version=0.0.4");
    res.end(telemetry.toPrometheusFormat());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

module.exports = router;
