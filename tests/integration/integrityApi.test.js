const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const TimelineEvent = require("../../src/models/TimelineEvent");
const InterviewSignal = require("../../src/models/InterviewSignal");

describe("Integrity & Proctoring REST API Integration Tests", () => {
  let seekerUser;
  let recruiterUser;
  let sessionDoc;
  let seekerToken;
  let recruiterToken;

  beforeEach(async () => {
    seekerUser = await User.create({
      name: "Charlie Candidate",
      email: `charlie_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
    });

    recruiterUser = await User.create({
      name: "Diana Recruiter",
      email: `diana_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
    });

    const jobDoc = await Job.create({
      title: "Core Platform Engineer",
      description: "Systems and Cybersecurity lead.",
      company: "Defense Tech Labs",
      recruiter: recruiterUser._id,
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      status: "applied",
    });

    sessionDoc = await InterviewSession.create({
      job: jobDoc._id,
      application: appDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      scheduledStart: new Date(),
      status: "LIVE",
      roomKey: `room_integ_${Date.now()}`,
    });

    const secret = config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678";
    seekerToken = jwt.sign({ id: seekerUser._id, role: "seeker" }, secret, { algorithm: "HS256" });
    recruiterToken = jwt.sign({ id: recruiterUser._id, role: "recruiter" }, secret, { algorithm: "HS256" });
  });

  describe("POST /api/integrity/telemetry", () => {
    it("should ingest paste event and flag instant bulk paste anomaly", async () => {
      const res = await request(app)
        .post("/api/integrity/telemetry")
        .set("Authorization", `Bearer ${seekerToken}`)
        .send({
          sessionId: sessionDoc._id,
          eventType: "clipboard.paste",
          offsetMs: 25000,
          pasteData: {
            text: "function solve() { return 42; }\n".repeat(10),
            characterCount: 320,
            durationMs: 40,
            lineCount: 10,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.evaluation.isAnomalous).toBe(true);
      expect(res.body.evaluation.classification).toBe("instant_bulk_paste");

      // Verify event was saved to TimelineEvent under INTEGRITY pipeline
      const savedEvents = await TimelineEvent.find({ session: sessionDoc._id, pipeline: "INTEGRITY" });
      expect(savedEvents.length).toBeGreaterThan(0);
      expect(savedEvents[0].eventType).toBe("clipboard.paste");
    });

    it("should ingest WebRTC network telemetry and detect latency surge", async () => {
      const res = await request(app)
        .post("/api/integrity/telemetry")
        .set("Authorization", `Bearer ${seekerToken}`)
        .send({
          sessionId: sessionDoc._id,
          eventType: "network.webrtc_stats",
          offsetMs: 35000,
          rtcStats: {
            currentRoundTripTimeMs: 480,
            jitterMs: 22,
            packetsLost: 10,
            totalPackets: 400,
            candidateType: "srflx",
          },
          previousRttMs: 60,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.evaluation.isAnomalous).toBe(true);
    });

    it("should reject unauthenticated telemetry ingestion", async () => {
      const res = await request(app)
        .post("/api/integrity/telemetry")
        .send({ sessionId: sessionDoc._id, eventType: "focus.blur" });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/integrity/similarity-check", () => {
    it("should detect plagiarism against reference corpus", async () => {
      const canonical = `
        function binarySearch(arr, x) {
          let l = 0, r = arr.length - 1;
          while (l <= r) {
            let m = Math.floor((l + r) / 2);
            if (arr[m] === x) return m;
            if (arr[m] < x) l = m + 1;
            else r = m - 1;
          }
          return -1;
        }
      `;

      const candidate = `
        function findIndex(nums, targetVal) {
          let leftIdx = 0, rightIdx = nums.length - 1;
          while (leftIdx <= rightIdx) {
            let midIdx = Math.floor((leftIdx + rightIdx) / 2);
            if (nums[midIdx] === targetVal) return midIdx;
            if (nums[midIdx] < targetVal) leftIdx = midIdx + 1;
            else rightIdx = midIdx - 1;
          }
          return -1;
        }
      `;

      const res = await request(app)
        .post("/api/integrity/similarity-check")
        .set("Authorization", `Bearer ${recruiterToken}`)
        .send({
          candidateCode: candidate,
          referenceCorpus: [{ title: "Binary Search Reference", code: canonical }],
          threshold: 0.7,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.analysis.isFlagged).toBe(true);
      expect(res.body.analysis.maxSimilarity).toBeGreaterThanOrEqual(0.75);
    });
  });

  describe("GET /api/integrity/session/:sessionId/report", () => {
    it("should return comprehensive session integrity report", async () => {
      await TimelineEvent.create({
        session: sessionDoc._id,
        pipeline: "INTEGRITY",
        eventType: "clipboard.paste",
        offsetMs: 12000,
        participant: seekerUser._id,
        participantRole: "seeker",
        payload: { isAnomalous: true, classification: "instant_bulk_paste" },
      });

      const res = await request(app)
        .get(`/api/integrity/session/${sessionDoc._id}/report`)
        .set("Authorization", `Bearer ${recruiterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.report.totalEvents).toBe(1);
      expect(res.body.report.pasteAnomaliesCount).toBe(1);
    });
  });
});
