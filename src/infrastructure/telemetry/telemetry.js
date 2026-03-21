const logger = require("../../config/logger");

/**
 * In-memory Prometheus-compatible metrics registry
 */
class TelemetryRegistry {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.startTime = Date.now();
  }

  incrementCounter(name, labels = {}, value = 1) {
    const key = this._formatKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  setGauge(name, value, labels = {}) {
    const key = this._formatKey(name, labels);
    this.gauges.set(key, value);
  }

  recordHistogram(name, value, labels = {}) {
    const key = this._formatKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    const samples = this.histograms.get(key);
    samples.push(value);
    if (samples.length > 500) samples.shift(); // Keep moving window
  }

  _formatKey(name, labels) {
    const labelEntries = Object.entries(labels);
    if (labelEntries.length === 0) return name;
    const labelStr = labelEntries
      .map(([k, v]) => `${k}="${v}"`)
      .sort()
      .join(",");
    return `${name}{${labelStr}}`;
  }

  toPrometheusFormat() {
    const lines = [];

    // System uptime
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    lines.push(`# HELP jobly_uptime_seconds Process uptime in seconds`);
    lines.push(`# TYPE jobly_uptime_seconds gauge`);
    lines.push(`jobly_uptime_seconds ${uptimeSec}`);

    // Counters
    for (const [key, val] of this.counters.entries()) {
      lines.push(`${key} ${val}`);
    }

    // Gauges
    for (const [key, val] of this.gauges.entries()) {
      lines.push(`${key} ${val}`);
    }

    // Histograms (avg & count)
    for (const [key, samples] of this.histograms.entries()) {
      const sum = samples.reduce((a, b) => a + b, 0);
      const count = samples.length;
      const avg = count > 0 ? (sum / count).toFixed(2) : 0;
      lines.push(`${key}_count ${count}`);
      lines.push(`${key}_sum ${sum}`);
      lines.push(`${key}_avg ${avg}`);
    }

    return lines.join("\n") + "\n";
  }

  reset() {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

const globalRegistry = new TelemetryRegistry();

/**
 * Express middleware to record HTTP metrics
 */
const metricsMiddleware = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const path = req.baseUrl || req.path || "root";
    const status = `${Math.floor(res.statusCode / 100)}xx`;

    globalRegistry.incrementCounter("http_requests_total", {
      method: req.method,
      status,
    });

    globalRegistry.recordHistogram("http_request_duration_ms", duration, {
      method: req.method,
    });
  });

  next();
};

module.exports = {
  telemetry: globalRegistry,
  metricsMiddleware,
};
