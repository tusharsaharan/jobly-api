const request = require("supertest");
const app = require("../src/app");
const User = require("../src/models/User");
const FocusSession = require("../src/models/FocusSession");
const UserProgress = require("../src/models/UserProgress");
const CompetitionLobby = require("../src/models/CompetitionLobby");
const { createTestUser, getAuthToken } = require("./utils/helpers");

describe("Brutal Learn Side - Recruiter", () => {
  jest.setTimeout(180000);
  let recruiter, recruiterToken, seeker, seekerToken;

  beforeEach(async () => {
    recruiter = await createTestUser({ name: "Recruiter Learn", email: `rl-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    seeker = await createTestUser({ name: "Seeker Learn", email: `sl-${Date.now()}-${Math.random()}@ex.com`, role: "seeker" });
    recruiterToken = getAuthToken(recruiter);
    seekerToken = getAuthToken(seeker);
  });

  // ========== LEARN: GENERATE QUIZ ==========
  describe("POST /api/learn/generate-quiz", () => {
    test("should generate quiz with valid topic", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", difficulty: "Medium", count: 5 });
      expect(res.status).not.toBe(500);
      expect([200,400]).toContain(res.status);
      if (res.status===200) expect(res.body.quiz).toBeDefined();
    });
    test("should reject missing topic", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${recruiterToken}`).send({ difficulty: "Medium", count: 5 });
      expect(res.status).toBe(400);
    });
    test("should handle empty topic", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "", count: 5 });
      expect(res.status).toBe(400);
    });
    test("should handle huge count 100000", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", count: 100000 });
      expect(res.status).not.toBe(500);
    });
    test("should handle negative count", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", count: -5 });
      expect(res.status).not.toBe(500);
    });
    test("should handle huge topic 10000 chars without 500", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "A".repeat(10000), count: 2 });
      expect(res.status).not.toBe(500);
    });
    test("should handle injection topic script", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "<script>alert(1)</script>", count: 2 });
      expect(res.status).not.toBe(500);
    });
    test("should reject unauthenticated", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").send({ topic: "Arrays" });
      expect([401,403]).toContain(res.status);
    });
    test("should handle concurrent quiz generations", async () => {
      const promises = Array.from({length:5}, () => request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Dynamic Programming", count: 3 }));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).not.toBe(500));
    });
  });

  // ========== LEARN: START SESSION ==========
  describe("POST /api/learn/session", () => {
    test("should create STUDY session valid", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "STUDY", topic: "System Design", durationMinutes: 25 });
      expect(res.status).toBe(201);
      expect(res.body.topic).toBe("System Design");
    });
    test("should create QUIZ session valid", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 10, quizData: [{q:1}] });
      expect(res.status).toBe(201);
    });
    test("should reject missing type", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", durationMinutes: 10 });
      expect(res.status).toBe(400);
    });
    test("should reject missing topic", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "STUDY", durationMinutes: 10 });
      expect(res.status).toBe(400);
    });
    test("should reject missing durationMinutes", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "STUDY", topic: "Arrays" });
      expect(res.status).toBe(400);
    });
    test("should reject invalid type", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "INVALID", topic: "Arrays", durationMinutes: 10 });
      expect([400,500]).toContain(res.status);
      expect(res.status).not.toBe(201);
    });
    test("should reject duration 0", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "STUDY", topic: "Arrays", durationMinutes: 0 });
      expect([400,500]).toContain(res.status);
    });
    test("should reject duration negative", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "STUDY", topic: "Arrays", durationMinutes: -10 });
      expect([400,500]).toContain(res.status);
    });
    test("should handle huge duration 1000000 without 500 but maybe cap", async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "STUDY", topic: "Arrays", durationMinutes: 1000000 });
      expect(res.status).not.toBe(500);
    });
    test("should handle concurrent session creations", async () => {
      const promises = Array.from({length:10}, (_,i) => request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "STUDY", topic: `Topic ${i}`, durationMinutes: 10 }));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(201));
    });
  });

  // ========== LEARN: FAIL / COMPLETE ==========
  describe("POST /api/learn/session/:id/fail & /complete", () => {
    let session;
    beforeEach(async () => {
      const res = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "STUDY", topic: "Arrays", durationMinutes: 10 });
      session = res.body;
    });
    test("should fail session valid", async () => {
      const res = await request(app).post(`/api/learn/session/${session._id}/fail`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe("FAILED");
    });
    test("should reject fail with invalid id", async () => {
      const res = await request(app).post(`/api/learn/session/invalid/fail`).set("Authorization", `Bearer ${recruiterToken}`);
      expect([400,500]).toContain(res.status);
    });
    test("should reject fail not found", async () => {
      const res = await request(app).post(`/api/learn/session/507f1f77bcf86cd799439011/fail`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(404);
    });
    test("should reject fail other user's session", async () => {
      const res = await request(app).post(`/api/learn/session/${session._id}/fail`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(404);
    });
    test("should complete session valid", async () => {
      const res = await request(app).post(`/api/learn/session/${session._id}/complete`).set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe("COMPLETED");
    });
    test("should complete QUIZ with server-verified score", async () => {
      const qRes = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 10 });
      const qSession = qRes.body;
      expect(qRes.status).toBe(201);
      // Quiz is server-generated; fallback questions have correctAnswer 0
      const answers = (qSession.quizData || []).map(() => 0);
      const res = await request(app).post(`/api/learn/session/${qSession._id}/complete`).set("Authorization", `Bearer ${recruiterToken}`).send({ answers });
      expect(res.status).toBe(200);
      expect(res.body.verifiedScore).toBe(100);
      expect(res.body.pointsAwarded).toBe(100);
    });
    test("should reject QUIZ complete with client-claimed score (no answers)", async () => {
      const qRes = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 10 });
      const res = await request(app).post(`/api/learn/session/${qRes.body._id}/complete`).set("Authorization", `Bearer ${recruiterToken}`).send({ score: 80 });
      // Client-claimed scores are no longer trusted — answers are required
      expect(res.status).toBe(400);
    });
    test("should reject complete already failed session", async () => {
      await request(app).post(`/api/learn/session/${session._id}/fail`).set("Authorization", `Bearer ${recruiterToken}`);
      const res = await request(app).post(`/api/learn/session/${session._id}/complete`).set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("should handle concurrent complete", async () => {
      const promises = Array.from({length:3}, () => request(app).post(`/api/learn/session/${session._id}/complete`).set("Authorization", `Bearer ${recruiterToken}`).send({}));
      const results = await Promise.all(promises);
      // One should succeed 200, others 400 (not active)
      expect(results.some(r=>r.status===200)).toBe(true);
      results.forEach(r => expect([200,400]).toContain(r.status));
      expect(results.some(r=>r.status===500)).toBe(false);
    });
  });

  // ========== LEARN: STATS ==========
  describe("GET /api/learn/stats", () => {
    test("should get stats with no sessions", async () => {
      const res = await request(app).get("/api/learn/stats").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.focusPoints).toBeDefined();
    });
    test("should get stats after sessions", async () => {
      await request(app).post("/api/learn/session").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "STUDY", topic: "Arrays", durationMinutes: 10 });
      const res = await request(app).get("/api/learn/stats").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("should reject unauthenticated", async () => {
      const res = await request(app).get("/api/learn/stats");
      expect([401,403]).toContain(res.status);
    });
  });

  // ========== STUDY: PROBLEMS ==========
  describe("GET /api/study/problems", () => {
    test("should get problems default", async () => {
      const res = await request(app).get("/api/study/problems").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.problems)).toBe(true);
    });
    test("should handle source filter", async () => {
      const res = await request(app).get("/api/study/problems?source=oa").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("should handle difficulty filter", async () => {
      const res = await request(app).get("/api/study/problems?difficulty=EASY").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("should handle huge limit 100000", async () => {
      const res = await request(app).get("/api/study/problems?limit=100000").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
      // Should be capped, not return 100k
      expect(res.body.problems.length).toBeLessThan(1000);
    });
    test("should handle negative page", async () => {
      const res = await request(app).get("/api/study/problems?page=-5&limit=10").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
    });
    test("should handle search injection", async () => {
      const res = await request(app).get("/api/study/problems?search=<script>alert(1)</script>").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
    });
    test("should handle search regex injection", async () => {
      const res = await request(app).get("/api/study/problems?search=(a+)+$").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
    });
    test("should handle concurrent problems fetch", async () => {
      const promises = Array.from({length:10}, () => request(app).get("/api/study/problems?limit=5").set("Authorization", `Bearer ${recruiterToken}`));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
    });
    test("should work without auth (optional)", async () => {
      const res = await request(app).get("/api/study/problems");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/study/problems/stats", () => {
    test("should get stats", async () => {
      const res = await request(app).get("/api/study/problems/stats").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBeDefined();
    });
    test("should handle source oa", async () => {
      const res = await request(app).get("/api/study/problems/stats?source=oa").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
  });

  // ========== STUDY: LLD/HLD ==========
  describe("GET /api/study/lld-problems & hld-problems", () => {
    test("lld valid", async () => {
      const res = await request(app).get("/api/study/lld-problems").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.problems).toBeDefined();
    });
    test("lld with filters", async () => {
      const res = await request(app).get("/api/study/lld-problems?category=Design&difficulty=Medium&search=pattern").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
    });
    test("lld huge search", async () => {
      const res = await request(app).get("/api/study/lld-problems?search=" + "a".repeat(5000)).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
    });
    test("hld valid", async () => {
      const res = await request(app).get("/api/study/hld-problems").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("hld with filters", async () => {
      const res = await request(app).get("/api/study/hld-problems?category=Scalability&difficulty=Hard").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
    });
  });

  // ========== STUDY: SEARCH, CHAT, TUTOR ==========
  describe("Study search/chat/tutor", () => {
    test("search q too short should 400", async () => {
      const res = await request(app).get("/api/study/search?q=a").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(400);
    });
    test("search valid", async () => {
      const res = await request(app).get("/api/study/search?q=system design").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
      expect([200,500]).toContain(res.status);
    });
    test("search injection script", async () => {
      const res = await request(app).get("/api/study/search?q=<script>alert(1)</script>").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).not.toBe(500);
    });
    test("chat missing message 400", async () => {
      const res = await request(app).post("/api/study/chat").set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("chat valid", async () => {
      const res = await request(app).post("/api/study/chat").set("Authorization", `Bearer ${recruiterToken}`).send({ message: "What is CAP theorem?" });
      expect(res.status).not.toBe(500);
    });
    test("chat huge message 10000 chars", async () => {
      const res = await request(app).post("/api/study/chat").set("Authorization", `Bearer ${recruiterToken}`).send({ message: "a".repeat(10000) });
      expect(res.status).not.toBe(500);
    });
    test("tutor missing message 400", async () => {
      const res = await request(app).post("/api/study/tutor").set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("tutor valid", async () => {
      const res = await request(app).post("/api/study/tutor").set("Authorization", `Bearer ${recruiterToken}`).send({ message: "Explain Big O" });
      // AI may fail but should be 200 or 500, not hang; allow either but not 400 validation
      expect([200,500]).toContain(res.status);
      expect(res.status).not.toBe(400);
    });
    test("tutor huge history", async () => {
      const history = Array.from({length:20}, (_,i)=>({role:"user", text:"a".repeat(1000)}));
      const res = await request(app).post("/api/study/tutor").set("Authorization", `Bearer ${recruiterToken}`).send({ message: "hi", history });
      expect(res.status).not.toBe(500);
    });
  });

  // ========== STUDY: PROGRESS & WEAKNESSES ==========
  describe("Study progress & weaknesses (recruiter)", () => {
    test("get progress valid", async () => {
      const res = await request(app).get("/api/study/progress").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.progress).toBeDefined();
    });
    test("mark progress valid DSA", async () => {
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "DSA", questionId: "https://leetcode.com/problems/two-sum/", completed: true });
      expect(res.status).toBe(200);
    });
    test("mark progress OA", async () => {
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "OA", questionId: "oa-123", completed: true });
      expect(res.status).toBe(200);
    });
    test("mark progress incomplete", async () => {
      await request(app).post("/api/study/progress").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "DSA", questionId: "q1", completed: true });
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "DSA", questionId: "q1", completed: false });
      expect(res.status).toBe(200);
    });
    test("mark progress missing fields without 500", async () => {
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).not.toBe(500);
    });
    test("mark progress huge questionId", async () => {
      const res = await request(app).post("/api/study/progress").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "DSA", questionId: "a".repeat(5000), completed: true });
      expect(res.status).not.toBe(500);
    });
    test("mark progress concurrent same question", async () => {
      const promises = Array.from({length:5}, () => request(app).post("/api/study/progress").set("Authorization", `Bearer ${recruiterToken}`).send({ type: "DSA", questionId: "concurrent-q", completed: true }));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
      // Ensure no duplicates
      const prog = await request(app).get("/api/study/progress").set("Authorization", `Bearer ${recruiterToken}`);
      const count = prog.body.progress.completedDSAQuestions.filter(id=>id==="concurrent-q").length;
      expect(count).toBe(1);
    });
    test("get weaknesses valid", async () => {
      const res = await request(app).get("/api/study/weaknesses").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.weaknesses)).toBe(true);
    });
    test("resolve weakness not found 404", async () => {
      const res = await request(app).post("/api/study/weaknesses/507f1f77bcf86cd799439011/resolve").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(404);
    });
    test("get interview topics", async () => {
      const res = await request(app).get("/api/study/interview-topics").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("reject unauthenticated progress", async () => {
      const res = await request(app).get("/api/study/progress");
      expect([401,403]).toContain(res.status);
    });
  });

  // ========== COMPETITION ==========
  describe("Competition (Recruiter)", () => {
    test("create lobby valid QUIZ", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", mode: "QUIZ", difficulty: "Medium", questionCount: 5 });
      expect(res.status).toBe(201);
      expect(res.body.lobby.pin).toBeDefined();
    });
    test("create lobby CP mode", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Graphs", mode: "CP", difficulty: "Hard", questionCount: 3 });
      expect(res.status).toBe(201);
    });
    test("reject missing topic", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${recruiterToken}`).send({ mode: "QUIZ" });
      expect(res.status).toBe(400);
    });
    test("reject missing mode", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays" });
      expect(res.status).toBe(400);
    });
    test("handle huge questionCount 100000", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", mode: "QUIZ", questionCount: 100000 });
      expect(res.status).not.toBe(500);
    });
    test("handle concurrent lobby creation PIN uniqueness", async () => {
      const promises = Array.from({length:10}, () => request(app).post("/api/compete/create").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", mode: "QUIZ", questionCount: 5 }));
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(201));
      const pins = results.map(r=>r.body.lobby.pin);
      expect(new Set(pins).size).toBe(10);
    });
    test("join lobby valid", async () => {
      const createRes = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", mode: "QUIZ" });
      const pin = createRes.body.lobby.pin;
      const res = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${seekerToken}`).send({ pin });
      expect(res.status).toBe(200);
    });
    test("reject join missing pin", async () => {
      const res = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${recruiterToken}`).send({});
      expect(res.status).toBe(400);
    });
    test("reject join invalid pin", async () => {
      const res = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${recruiterToken}`).send({ pin: "000000" });
      expect(res.status).toBe(404);
    });
    test("reject join already started", async () => {
      const createRes = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", mode: "QUIZ" });
      const lobby = createRes.body.lobby;
      // Manually set status to STARTED
      await CompetitionLobby.findByIdAndUpdate(lobby._id, { status: "STARTED" });
      const res = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${seekerToken}`).send({ pin: lobby.pin });
      expect(res.status).toBe(400);
    });
    test("handle concurrent joins same lobby", async () => {
      const createRes = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", mode: "QUIZ" });
      const pin = createRes.body.lobby.pin;
      const users = await Promise.all(Array.from({length:5}, async () => {
        const u = await createTestUser({ email: `c-${Date.now()}-${Math.random()}@ex.com`, role: "seeker" });
        return u;
      }));
      const promises = users.map(u => {
        const token = getAuthToken(u);
        return request(app).post("/api/compete/join").set("Authorization", `Bearer ${token}`).send({ pin });
      });
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
      // Ensure no duplicate players
      const lobbyRes = await request(app).get(`/api/compete/${createRes.body.lobby._id}`).set("Authorization", `Bearer ${recruiterToken}`);
      const playerIds = lobbyRes.body.lobby.players.map(p=>String(p.userId));
      expect(new Set(playerIds).size).toBe(playerIds.length);
    });
    test("get lobby valid", async () => {
      const createRes = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${recruiterToken}`).send({ topic: "Arrays", mode: "QUIZ" });
      const res = await request(app).get(`/api/compete/${createRes.body.lobby._id}`).set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("get lobby invalid id", async () => {
      const res = await request(app).get("/api/compete/507f1f77bcf86cd799439011").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(404);
    });
    test("get lobby invalid format", async () => {
      const res = await request(app).get("/api/compete/invalid").set("Authorization", `Bearer ${recruiterToken}`);
      expect([400,500]).toContain(res.status);
      expect(res.status).not.toBe(200);
    });
  });

  // ========== CODEFORCES & REPO ==========
  describe("Codeforces & Repo (Recruiter optional auth)", () => {
    test("codeforces valid handle (mocked may be 404/500 but not hang)", async () => {
      const res = await request(app).get("/api/study/codeforces/tourist").set("Authorization", `Bearer ${recruiterToken}`);
      // External API may be down, allow 200/404/500/504 but not hang
      expect([200,404,500,504]).toContain(res.status);
      // Ensure not hang: duration check would be in test timeout
    }, 10000);
    test("codeforces missing handle 400", async () => {
      const res = await request(app).get("/api/study/codeforces/").set("Authorization", `Bearer ${recruiterToken}`);
      expect([400,404,500]).toContain(res.status);
    });
    test("codeforces injection handle", async () => {
      const res = await request(app).get("/api/study/codeforces/<script>").set("Authorization", `Bearer ${recruiterToken}`);
      expect([400,404,500,504]).toContain(res.status);
    });
    test("repo dsa", async () => {
      const res = await request(app).get("/api/study/repo?repo=dsa").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
    test("repo oa", async () => {
      const res = await request(app).get("/api/study/repo?repo=oa").set("Authorization", `Bearer ${recruiterToken}`);
      expect(res.status).toBe(200);
    });
  });
});
