const logger = require("../../config/logger");

// In-memory active session connection cache (maps sessionId:participantId -> telemetry history)
const sessionConnectionState = new Map();

/**
 * Extract /24 subnet prefix from IPv4 or /48 from IPv6 for topological continuity
 */
function getSubnetPrefix(ip) {
  if (!ip) return "";
  const cleanIp = ip.replace(/^::ffff:/, ""); // unwrap IPv4-mapped IPv6
  if (cleanIp.includes(".")) {
    const parts = cleanIp.split(".");
    return parts.slice(0, 3).join(".");
  }
  if (cleanIp.includes(":")) {
    const parts = cleanIp.split(":");
    return parts.slice(0, 3).join(":");
  }
  return cleanIp;
}

/**
 * 1. Track and evaluate IP Address Consistency
 */
function trackConnectionIp({ sessionId, participantId, ipAddress, userAgent = "" }) {
  const key = `${sessionId}:${participantId}`;
  const now = new Date().toISOString();
  const cleanIp = (ipAddress || "").replace(/^::ffff:/, "");

  if (!sessionConnectionState.has(key)) {
    sessionConnectionState.set(key, {
      initialIp: cleanIp,
      currentIp: cleanIp,
      subnetPrefix: getSubnetPrefix(cleanIp),
      userAgent,
      history: [{ ip: cleanIp, timestamp: now }],
      ipChanges: 0,
      subnetChanges: 0,
    });

    return {
      isAnomalous: false,
      ipChanges: 0,
      initialIp: cleanIp,
      currentIp: cleanIp,
      reason: null,
    };
  }

  const state = sessionConnectionState.get(key);

  if (state.currentIp !== cleanIp) {
    const newSubnet = getSubnetPrefix(cleanIp);
    const isSubnetChanged = state.subnetPrefix !== newSubnet;

    state.ipChanges++;
    if (isSubnetChanged) state.subnetChanges++;

    state.currentIp = cleanIp;
    state.subnetPrefix = newSubnet;
    state.history.push({ ip: cleanIp, timestamp: now });

    const isAnomalous = state.ipChanges >= 2 || isSubnetChanged;

    return {
      isAnomalous,
      ipChanges: state.ipChanges,
      subnetChanges: state.subnetChanges,
      initialIp: state.initialIp,
      currentIp: cleanIp,
      reason: isSubnetChanged
        ? `Participant IP transitioned across subnets (${state.initialIp} -> ${cleanIp}). Possible VPN/Proxy toggle or external device connection.`
        : `Participant IP changed within same subnet (${state.initialIp} -> ${cleanIp}).`,
    };
  }

  return {
    isAnomalous: false,
    ipChanges: state.ipChanges,
    initialIp: state.initialIp,
    currentIp: cleanIp,
    reason: null,
  };
}

/**
 * 2. Analyze WebRTC PeerConnection Telemetry Metrics (RTT, Jitter, Packet Loss, ICE candidate pair)
 */
function analyzeWebRtcStats({
  currentRoundTripTimeMs = 0,
  jitterMs = 0,
  packetsLost = 0,
  totalPackets = 100,
  candidateType = "host", // host | srflx | prflx | relay
  previousRttMs = 0,
}) {
  const anomalies = [];
  let severity = "low";

  // Latency Spike / VPN toggle detection
  const rttDelta = currentRoundTripTimeMs - previousRttMs;
  if (previousRttMs > 0 && rttDelta > 300) {
    anomalies.push(`Sudden round-trip time latency surge (+${Math.round(rttDelta)}ms)`);
    severity = "medium";
  } else if (currentRoundTripTimeMs > 800) {
    anomalies.push(`High network latency (${Math.round(currentRoundTripTimeMs)}ms RTT)`);
    severity = "medium";
  }

  // Packet Loss calculation
  const packetLossRatio = totalPackets > 0 ? packetsLost / totalPackets : 0;
  if (packetLossRatio > 0.15) {
    anomalies.push(`Significant packet loss rate (${Math.round(packetLossRatio * 100)}%)`);
    severity = severity === "medium" ? "high" : "medium";
  }

  // TURN Relay usage (often behind strict symmetric NATs or corporate firewall)
  const isRelay = candidateType === "relay";

  return {
    isAnomalous: anomalies.length > 0,
    severity,
    anomalies,
    metrics: {
      rttMs: currentRoundTripTimeMs,
      jitterMs,
      packetLossRatio: Math.round(packetLossRatio * 1000) / 1000,
      candidateType,
      isRelayed: isRelay,
    },
  };
}

/**
 * Reset memory state (useful for tests)
 */
function resetNetworkState() {
  sessionConnectionState.clear();
}

module.exports = {
  trackConnectionIp,
  analyzeWebRtcStats,
  getSubnetPrefix,
  resetNetworkState,
};
