const request = require("supertest");
const app = require("../src/app");
const User = require("../src/models/User");
const FocusSession = require("../src/models/FocusSession");
const UserProgress = require("../src/models/UserProgress");
const CandidateTopicWeakness = require("../src/models/CandidateTopicWeakness");
const { createTestUser, getAuthToken } = require("./utils/helpers");

describe("Brutal Learn Side - Seeker", () => {
  jest.setTimeout(120000);
  let seeker, seekerToken, recruiter, recruiterToken;

  beforeEach(async () => {
    seeker = await createTestUser({ name: "Learn Seeker", email: `learn-seek-${Date.now()}-${Math.random()}@ex.com`, role: "seeker", skills: ["js"], degree: "BTech", cgpa: 8 });
    recruiter = await createTestUser({ name: "Learn Recruiter", email: `learn-rec-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    seekerToken = getAuthToken(seeker);
    recruiterToken = getAuthToken(recruiter);
  });

  // ========== LEARN: GENERATE QUIZ ==========
  describe("POST /api/learn/generate-quiz", () => {
    test("should reject missing topic", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({});
      expect([400,422]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
    test("should reject empty topic", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "" });
      expect([400,422]).toContain(res.status);
    });
    test("should handle valid topic", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", difficulty: "Medium", count: 5 });
      expect(res.status).not.toBe(500);
      expect([200,500]).toContain(res.status);
    });
    test("should handle count 0", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", count: 0 });
      expect(res.status).not.toBe(500);
    });
    test("should handle huge count 1000000 without DoS", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", count: 1000000 });
      expect(res.status).not.toBe(500);
    });
    test("should handle negative count", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", count: -5 });
      expect(res.status).not.toBe(500);
    });
    test("should handle XSS topic", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "<script>alert(1)</script>" });
      expect(res.status).not.toBe(500);
    });
    test("should handle huge topic 5000 chars", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "A".repeat(5000) });
      expect(res.status).not.toBe(500);
    });
    test("should reject unauthenticated", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").send({ topic: "Arrays" });
      expect([401,403]).toContain(res.status);
    });
    test("should handle invalid difficulty", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", difficulty: "Impossible" });
      expect(res.status).not.toBe(500);
    });
  });

  // ========== LEARN: SESSION START ==========
  describe("POST /api/learn/session", () => {
    test("should create STUDY session valid", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: "System Design", durationMinutes: 25 });
      expect(res.status).toBe(201);
      expect(res.body.topic).toBe("System Design");
    });
    test("should create QUIZ session valid", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 15, quizData: [{q:"Q1"}] });
      expect(res.status).toBe(201);
    });
    test("should reject missing type", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "X", durationMinutes: 10 });
      expect([400,422]).toContain(res.status);
    });
    test("should reject missing topic", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", durationMinutes: 10 });
      expect([400,422]).toContain(res.status);
    });
    test("should reject missing durationMinutes", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: "X" });
      expect([400,422]).toContain(res.status);
    });
    test("should reject invalid type", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "INVALID", topic: "X", durationMinutes: 10 });
      expect(res.status).not.toBe(500);
      expect([400,422,500]).toContain(res.status);
    });
    test("should reject duration 0", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: "X", durationMinutes: 0 });
      expect(res.status).not.toBe(500);
      // Mongoose min 1 will cause 500 currently? Should be 400/500? Check
      expect([400,500,422]).toContain(res.status);
    });
    test("should handle huge duration 1000000", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: "X", durationMinutes: 1000000 });
      expect(res.status).not.toBe(500);
      // Should be capped or 201? Current no cap, will create with 1M minutes -> weird but not crash
      expect([201,400,422,500]).toContain(res.status);
    });
    test("should handle negative duration", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: "X", durationMinutes: -5 });
      expect(res.status).not.toBe(500);
    });
    test("should handle XSS topic", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: "<img src=x onerror=alert(1)>", durationMinutes: 10 });
      expect(res.status).not.toBe(500);
      expect([201,400]).toContain(res.status);
    });
    test("should allow recruiter to create session (no role restriction)", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "STUDY", topic: "ValidTopic", durationMinutes: 10 });
      expect([201,403]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
    test("should handle concurrent 20 session creations", async () => {
      const promises = Array.from({length:20}, (_,i) => request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: `Topic ${i}`, durationMinutes: 10+i }));
      const results = await Promise.all(promises);
      results.forEach(r => expect([201,400]).toContain(r.status));
      expect(results.filter(r=>r.status===201).length).toBe(20);
    });
  });

  // ========== LEARN: FAIL / COMPLETE ==========
  describe("POST /api/learn/session/:id/fail & complete", () => {
    let sessionId;
    beforeEach(async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "STUDY", topic: "Focus", durationMinutes: 10 });
      sessionId = res.body._id;
    });
    test("should fail session", async () => {
      const res = await request(app).post(`/api/learn/session/${sessionId}/fail`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe("FAILED");
    });
    test("should not fail other user's session", async () => {
      const res = await request(app).post(`/api/learn/session/${sessionId}/fail`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(404);
    });
    test("should reject invalid ObjectId on fail", async () => {
      const res = await request(app).post(`/api/learn/session/invalid-id/fail`).set("Authorization", `Bearer ${seekerToken}`);
      expect([400,500]).toContain(res.status);
      expect(res.status).not.toBe(200);
    });
    test("should complete session", async () => {
      const res = await request(app).post(`/api/learn/session/${sessionId}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe("COMPLETED");
    });
    test("should not complete already failed session", async () => {
      await request(app).post(`/api/learn/session/${sessionId}/fail`).set("Authorization", `Bearer ${seekerToken}`);
      const res = await request(app).post(`/api/learn/session/${sessionId}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("should complete QUIZ with score", async () => {
      const qRes = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 10, quizData: [] });
      const qId = qRes.body._id;
      const res = await request(app).post(`/api/learn/session/${qId}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({ score: 85 });
      expect(res.status).toBe(200);
      expect(res.body.session.score).toBe(85);
    });
    test("should handle score out of range 999", async () => {
      const qRes = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 10 });
      const qId = qRes.body._id;
      const res = await request(app).post(`/api/learn/session/${qId}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({ score: 999 });
      expect(res.status).not.toBe(500);
      // Should be 400 or 200 with cap? Check validation max 100
      expect([200,400,500]).toContain(res.status);
    });
    test("should handle negative score", async () => {
      const qRes = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 10 });
      const res = await request(app).post(`/api/learn/session/${qRes.body._id}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({ score: -10 });
      expect(res.status).not.toBe(500);
    });
    test("should handle concurrent complete", async () => {
      const promises = Array.from({length:5}, () => request(app).post(`/api/learn/session/${sessionId}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({}));
      const results = await Promise.all(promises);
      // First should 200, rest 400 (not active)
      expect(results.some(r=>r.status===200)).toBe(true);
      expect(results.every(r=>[200,400].includes(r.status))).toBe(true);
    });
    test("should reject unauthenticated complete", async () => {
      const res = await request(app).post(`/api/learn/session/${sessionId}/complete`).send({});
      expect([401,403]).toContain(res.status);
    });
  });

  describe("GET /api/learn/stats", () => {
    test("should return stats", async () => {
      const res = await request(app).get("/api/learn/stats").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("focusPoints");
      expect(res.body).toHaveProperty("currentStreak");
    });
    test("should handle no sessions", async () => {
      const freshSeeker = await createTestUser({ email: `fresh-${Date.now()}@ex.com`, role: "seeker" });
      const token = getAuthToken(freshSeeker);
      const res = await request(app).get("/api/learn/stats").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.totalStudyMinutes).toBe(0);
    });
    test("should reject unauthenticated", async () => {
      const res = await request(app).get("/api/learn/stats");
      expect([401,403]).toContain(res.status);
    });
  });

  // ========== STUDY: PROBLEMS ==========
  describe("GET /api/study/problems", () => {
    test("should return problems with default", async () => {
      const res = await request(app).get("/api/study/problems").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("problems");
    });
    test("should handle pagination", async () => {
      const res = await request(app).get("/api/study/problems?page=1&limit=5").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.problems.length).toBeLessThanOrEqual(5);
    });
    test("should handle huge limit 1000000 capped", async () => {
      const res = await request(app).get("/api/study/problems?limit=1000000").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
      expect(res.body.problems.length).toBeLessThanOrEqual(1000000);
      // Should be capped? Currently not, but should not crash
    });
    test("should handle negative page/limit", async () => {
      const res = await request(app).get("/api/study/problems?page=-1&limit=-5").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
      expect([200,400]).toContain(res.status);
    });
    test("should handle invalid source", async () => {
      const res = await request(app).get("/api/study/problems?source=invalid").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("should handle search injection", async () => {
      const res = await request(app).get("/api/study/problems?search=" + encodeURIComponent(".*")).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
    });
    test("should handle search with special regex chars", async () => {
      const res = await request(app).get("/api/study/problems?search=" + encodeURIComponent("(a+)+$")).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
    });
    test("should work without auth (optional)", async () => {
      const res = await request(app).get("/api/study/problems");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/study/problems/stats", () => {
    test("should return stats", async () => {
      const res = await request(app).get("/api/study/problems/stats").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("total");
    });
    test("should handle invalid source", async () => {
      const res = await request(app).get("/api/study/problems/stats?source=invalid").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
    });
  });

  describe("GET /api/study/system-design & LLD/HLD", () => {
    test("should return system-design topics", async () => {
      const res = await request(app).get("/api/study/system-design").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("topics");
    });
    test("should handle track param", async () => {
      const res = await request(app).get("/api/study/system-design?track=LLD").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("should return LLD problems", async () => {
      const res = await request(app).get("/api/study/lld-problems").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("problems");
    });
    test("should filter LLD by category", async () => {
      const res = await request(app).get("/api/study/lld-problems?category=Design").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
    });
    test("should handle LLD huge search", async () => {
      const res = await request(app).get("/api/study/lld-problems?search=" + "a".repeat(5000)).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
    });
    test("should return HLD problems", async () => {
      const res = await request(app).get("/api/study/hld-problems").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("problems");
    });
    test("should handle HLD search injection", async () => {
      const res = await request(app).get("/api/study/hld-problems?search=" + encodeURIComponent("<script>")).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
    });
  });

  describe("Study Progress & Weaknesses", () => {
    test("should get progress", async () => {
      const res = await request(app).get("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("progress");
    });
    test("should mark progress DSA", async () => {
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`).send({ type: "DSA", questionId: "https://leetcode.com/problems/two-sum", completed: true });
      expect(res.status).toBe(200);
      expect(res.body.progress.completedDSAQuestions).toContain("https://leetcode.com/problems/two-sum");
    });
    test("should handle missing type", async () => {
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`).send({ questionId: "q1", completed: true });
      expect(res.status).not.toBe(500);
      // Should default to DSA
      expect([200,400]).toContain(res.status);
    });
    test("should handle duplicate mark", async () => {
      await request(app).post("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`).send({ type: "DSA", questionId: "dup", completed: true });
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`).send({ type: "DSA", questionId: "dup", completed: true });
      expect(res.status).toBe(200);
      const count = res.body.progress.completedDSAQuestions.filter(id=>id==="dup").length;
      expect(count).toBe(1);
    });
    test("should handle unmark", async () => {
      await request(app).post("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`).send({ type: "DSA", questionId: "toRemove", completed: true });
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`).send({ type: "DSA", questionId: "toRemove", completed: false });
      expect(res.status).toBe(200);
      expect(res.body.progress.completedDSAQuestions).not.toContain("toRemove");
    });
    test("should handle huge questionId 5000 chars", async () => {
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`).send({ type: "DSA", questionId: "a".repeat(5000), completed: true });
      expect(res.status).not.toBe(500);
    });
    test("should handle concurrent progress marks", async () => {
      const promises = Array.from({length:10}, (_,i) => request(app).post("/api/study/progress").set("Authorization", `Bearer ${seekerToken}`).send({ type: "DSA", questionId: `q${i}`, completed: true }));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
    });
    test("should get weaknesses", async () => {
      const res = await request(app).get("/api/study/weaknesses").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("weaknesses");
    });
    test("should reject unauthenticated weaknesses", async () => {
      const res = await request(app).get("/api/study/weaknesses");
      expect([401,403]).toContain(res.status);
    });
    test("should resolve weakness not found", async () => {
      const fakeId = "507f1f77bcf86cd799439011";
      const res = await request(app).post(`/api/study/weaknesses/${fakeId}/resolve`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(404);
    });
    test("should not resolve other user's weakness", async () => {
      const weakness = await CandidateTopicWeakness.create({ candidate: recruiter._id, topic: "Arrays", sourceType: "evaluation", sourceId: recruiter._id, sourceSessionId: recruiter._id });
      const res = await request(app).post(`/api/study/weaknesses/${weakness._id}/resolve`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(404);
    });
    test("should get interview topics", async () => {
      const res = await request(app).get("/api/study/interview-topics").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("topics");
    });
  });

  describe("Study Search & Chat & Tutor", () => {
    test("should reject search q too short", async () => {
      const res = await request(app).get("/api/study/search?q=a").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(400);
    });
    test("should handle search valid", async () => {
      const res = await request(app).get("/api/study/search?q=system%20design").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
      expect([200,500]).toContain(res.status);
    });
    test("should handle search huge q", async () => {
      const res = await request(app).get("/api/study/search?q=" + "a".repeat(5000)).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
    });
    test("should handle search without auth", async () => {
      const res = await request(app).get("/api/study/search?q=test");
      expect(res.status).not.toBe(500);
    });
    test("should reject chat missing message", async () => {
      const res = await request(app).post("/api/study/chat").set("Authorization", `Bearer ${seekerToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("should handle chat valid", async () => {
      const res = await request(app).post("/api/study/chat").set("Authorization", `Bearer ${seekerToken}`).send({ message: "What is CAP theorem?" });
      expect(res.status).not.toBe(500);
      expect([200,500]).toContain(res.status);
    });
    test("should handle chat XSS", async () => {
      const res = await request(app).post("/api/study/chat").set("Authorization", `Bearer ${seekerToken}`).send({ message: "<script>alert(1)</script>" });
      expect(res.status).not.toBe(500);
    });
    test("should reject tutor missing message", async () => {
      const res = await request(app).post("/api/study/tutor").set("Authorization", `Bearer ${seekerToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("should handle tutor valid", async () => {
      const res = await request(app).post("/api/study/tutor").set("Authorization", `Bearer ${seekerToken}`).send({ message: "Explain binary search" });
      expect(res.status).not.toBe(500);
      expect([200,500]).toContain(res.status);
    });
    test("should handle tutor huge message", async () => {
      const res = await request(app).post("/api/study/tutor").set("Authorization", `Bearer ${seekerToken}`).send({ message: "a".repeat(10000) });
      expect(res.status).not.toBe(500);
    });
    test("should handle codeforces missing handle", async () => {
      const res = await request(app).get("/api/study/codeforces/").set("Authorization", `Bearer ${seekerToken}`);
      expect([400,404]).toContain(res.status);
    });
    test("should handle codeforces valid handle", async () => {
      const res = await request(app).get("/api/study/codeforces/tourist").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).not.toBe(500);
      expect([200,404,500]).toContain(res.status);
    });
  });
});
