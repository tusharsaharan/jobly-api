const {
  trackConnectionIp,
  analyzeWebRtcStats,
  getSubnetPrefix,
  resetNetworkState,
} = require("../../src/modules/integrity/networkIntegrityTracker");

describe("Network & WebRTC Session Integrity Unit Tests", () => {
  beforeEach(() => {
    resetNetworkState();
  });

  describe("getSubnetPrefix", () => {
    it("should extract IPv4 /24 subnet correctly", () => {
      expect(getSubnetPrefix("192.168.1.50")).toBe("192.168.1");
      expect(getSubnetPrefix("::ffff:10.0.5.12")).toBe("10.0.5");
    });

    it("should extract IPv6 /48 prefix", () => {
      expect(getSubnetPrefix("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe("2001:0db8:85a3");
    });
  });

  describe("trackConnectionIp", () => {
    it("should record initial IP without anomaly", () => {
      const res = trackConnectionIp({
        sessionId: "sess-net-1",
        participantId: "user-1",
        ipAddress: "203.0.113.10",
      });

      expect(res.isAnomalous).toBe(false);
      expect(res.ipChanges).toBe(0);
      expect(res.currentIp).toBe("203.0.113.10");
    });

    it("should allow same-subnet dynamic DHCP IP shift without hard anomaly", () => {
      trackConnectionIp({
        sessionId: "sess-net-2",
        participantId: "user-1",
        ipAddress: "192.168.1.10",
      });

      const res = trackConnectionIp({
        sessionId: "sess-net-2",
        participantId: "user-1",
        ipAddress: "192.168.1.45",
      });

      expect(res.ipChanges).toBe(1);
      expect(res.subnetChanges).toBe(0);
      expect(res.isAnomalous).toBe(false);
    });

    it("should flag cross-subnet IP hop (VPN / external connection change)", () => {
      trackConnectionIp({
        sessionId: "sess-net-3",
        participantId: "user-1",
        ipAddress: "198.51.100.22",
      });

      const res = trackConnectionIp({
        sessionId: "sess-net-3",
        participantId: "user-1",
        ipAddress: "203.0.113.88",
      });

      expect(res.isAnomalous).toBe(true);
      expect(res.subnetChanges).toBe(1);
      expect(res.reason).toContain("transitioned across subnets");
    });
  });

  describe("analyzeWebRtcStats", () => {
    it("should evaluate clean low-latency WebRTC metrics without anomalies", () => {
      const res = analyzeWebRtcStats({
        currentRoundTripTimeMs: 45,
        jitterMs: 4,
        packetsLost: 1,
        totalPackets: 1000,
        candidateType: "host",
        previousRttMs: 42,
      });

      expect(res.isAnomalous).toBe(false);
      expect(res.metrics.rttMs).toBe(45);
      expect(res.metrics.isRelayed).toBe(false);
    });

    it("should flag sudden latency surge (+350ms)", () => {
      const res = analyzeWebRtcStats({
        currentRoundTripTimeMs: 420,
        jitterMs: 25,
        packetsLost: 5,
        totalPackets: 500,
        candidateType: "srflx",
        previousRttMs: 50,
      });

      expect(res.isAnomalous).toBe(true);
      expect(res.anomalies.some((a) => a.includes("latency surge"))).toBe(true);
      expect(res.severity).toBe("medium");
    });

    it("should flag severe packet loss exceeding threshold", () => {
      const res = analyzeWebRtcStats({
        currentRoundTripTimeMs: 120,
        jitterMs: 15,
        packetsLost: 250,
        totalPackets: 1000, // 25% loss
        candidateType: "relay",
      });

      expect(res.isAnomalous).toBe(true);
      expect(res.metrics.packetLossRatio).toBe(0.25);
      expect(res.metrics.isRelayed).toBe(true);
      expect(res.anomalies.some((a) => a.includes("packet loss"))).toBe(true);
    });
  });
});
