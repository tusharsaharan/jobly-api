const request = require("supertest");
const app = require("../src/app");
const User = require("../src/models/User");
const CompetitionLobby = require("../src/models/CompetitionLobby");
const FocusSession = require("../src/models/FocusSession");
const { createTestUser, getAuthToken } = require("./utils/helpers");

describe("Brutal Compete & Quiz — 1Lakh Scale", () => {
  jest.setTimeout(180000);
  let seeker, seekerToken, recruiter, recruiterToken;

  beforeEach(async () => {
    seeker = await createTestUser({ name: "Quiz Seeker", email: `quiz-s-${Date.now()}-${Math.random()}@ex.com`, role: "seeker", skills: ["js"], degree: "BTech", cgpa: 8 });
    recruiter = await createTestUser({ name: "Quiz Recruiter", email: `quiz-r-${Date.now()}-${Math.random()}@ex.com`, role: "recruiter" });
    seekerToken = getAuthToken(seeker);
    recruiterToken = getAuthToken(recruiter);
  });

  function validateQuiz(quiz, expectedCount, topic) {
    expect(Array.isArray(quiz)).toBe(true);
    expect(quiz.length).toBeGreaterThan(0);
    expect(quiz.length).toBeLessThanOrEqual(20);
    if (expectedCount) expect(quiz.length).toBe(expectedCount);
    for (const q of quiz) {
      expect(q).toHaveProperty("question");
      expect(typeof q.question).toBe("string");
      expect(q.question.length).toBeGreaterThan(5);
      if (topic) expect(q.question.toLowerCase() + JSON.stringify(q).toLowerCase()).toMatch(topic.toLowerCase().slice(0,4));
      expect(q).toHaveProperty("options");
      expect(Array.isArray(q.options)).toBe(true);
      expect(q.options.length).toBe(4);
      q.options.forEach(opt => { expect(typeof opt).toBe("string"); expect(opt.length).toBeGreaterThan(0); });
      expect(q).toHaveProperty("correctAnswer");
      expect(typeof q.correctAnswer).toBe("number");
      expect(q.correctAnswer).toBeGreaterThanOrEqual(0);
      expect(q.correctAnswer).toBeLessThanOrEqual(3);
      // explanation is optional but should be string if present
      if (q.explanation) expect(typeof q.explanation).toBe("string");
      // timeLimitSeconds should be 5-60
      if (q.timeLimitSeconds !== undefined) {
        expect(q.timeLimitSeconds).toBeGreaterThanOrEqual(5);
        expect(q.timeLimitSeconds).toBeLessThanOrEqual(60);
      }
    }
  }

  function validateCP(cpData, topic) {
    expect(cpData).toBeDefined();
    expect(cpData).toHaveProperty("problemStatement");
    expect(typeof cpData.problemStatement).toBe("string");
    expect(cpData.problemStatement.length).toBeGreaterThan(10);
    if (topic) expect(cpData.problemStatement.toLowerCase()).toMatch(topic.toLowerCase().slice(0,3));
    expect(cpData).toHaveProperty("initialCode");
    expect(typeof cpData.initialCode).toBe("string");
    expect(cpData.initialCode.length).toBeGreaterThan(0);
    expect(cpData).toHaveProperty("testCases");
    expect(Array.isArray(cpData.testCases)).toBe(true);
    expect(cpData.testCases.length).toBeGreaterThan(0);
    for (const tc of cpData.testCases) {
      expect(tc).toHaveProperty("input");
      expect(tc).toHaveProperty("expectedOutput");
    }
  }

  // ========== QUIZ GENERATION BRUTAL 100+ ==========
  describe("POST /api/learn/generate-quiz — Stress 100+", () => {
    const topics = ["Arrays", "Dynamic Programming", "Graphs", "System Design", "Operating Systems", "DBMS", "Networking", "OOP", "Java", "Python", "C++", "SQL", "Machine Learning", "Blockchain", "DevOps", "<script>alert(1)</script>", "A".repeat(200), " ", "123", "Data Structures & Algorithms"];
    const difficulties = ["Easy", "Medium", "Hard", "Mixed", "Invalid", "", null];
    const counts = [1, 3, 5, 10, 15, 20, 0, -5, 100000, "abc", null];

    test("should handle 20 valid topic/difficulty combos without 500", async () => {
      for (let i = 0; i < 20; i++) {
        const topic = topics[i % topics.length];
        const difficulty = difficulties[i % difficulties.length] || "Medium";
        const count = counts[i % counts.length];
        const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic, difficulty, count });
        expect(res.status).not.toBe(500);
        if (topic && String(topic).trim().length >= 2 && !String(topic).includes("<script>") && topic.trim() !== " " && topic.length < 200) {
          if (res.status === 200) {
            expect(res.body.quiz).toBeDefined();
            validateQuiz(res.body.quiz, null, topic);
          }
        } else {
          expect([200,400]).toContain(res.status);
        }
      }
    });

    test("should generate quiz with exact count 5", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", difficulty: "Medium", count: 5 });
      expect(res.status).toBe(200);
      expect(res.body.quiz).toBeDefined();
      validateQuiz(res.body.quiz, 5, "Arrays");
    });

    test("should generate quiz with count 20 (max)", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Graphs", difficulty: "Hard", count: 20 });
      expect(res.status).toBe(200);
      validateQuiz(res.body.quiz, 20, "Graphs");
    });

    test("should cap count 100000 to 20", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", count: 100000 });
      expect(res.status).toBe(200);
      expect(res.body.quiz.length).toBeLessThanOrEqual(20);
    });

    test("should handle count 0 fallback to 5", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", count: 0 });
      expect(res.status).toBe(200);
      expect(res.body.quiz.length).toBeGreaterThan(0);
    });

    test("should handle XSS topic without 500 and quiz still valid", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "<script>alert(1)</script>", count: 5 });
      expect(res.status).not.toBe(500);
      if (res.status === 200) validateQuiz(res.body.quiz, 5, "script");
    });

    test("should handle huge topic 5000 chars without 500", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "A".repeat(5000), count: 5 });
      expect(res.status).not.toBe(500);
      expect([200,400]).toContain(res.status);
    });

    test("should handle invalid difficulty fallback to Medium", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", difficulty: "Impossible", count: 5 });
      expect(res.status).toBe(200);
      validateQuiz(res.body.quiz, 5, "Arrays");
    });

    test("should handle concurrent 20 quiz generations (1Lakh scale)", async () => {
      const promises = Array.from({ length: 20 }, (_, i) => 
        request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: `Topic ${i} Arrays`, difficulty: ["Easy","Medium","Hard"][i%3], count: 5 })
      );
      const results = await Promise.all(promises);
      results.forEach(r => {
        expect(r.status).not.toBe(500);
        expect([200,400]).toContain(r.status);
        if (r.status === 200) validateQuiz(r.body.quiz, 5, "Topic");
      });
    });

    test("should handle rapid 50 quiz generations stress", async () => {
      const promises = Array.from({ length: 50 }, () => 
        request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "System Design", difficulty: "Medium", count: 3 })
      );
      const results = await Promise.all(promises);
      results.forEach(r => {
        expect(r.status).not.toBe(500);
        if (r.status === 200) {
          expect(r.body.quiz).toBeDefined();
          expect(r.body.quiz.length).toBe(3);
          validateQuiz(r.body.quiz, 3, "System");
        }
      });
      expect(results.filter(r=>r.status===200).length).toBeGreaterThan(40);
    });

    test("should reject missing topic 400", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ difficulty: "Medium", count: 5 });
      expect(res.status).toBe(400);
    });

    test("should handle empty topic 400", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "", count: 5 });
      expect(res.status).toBe(400);
    });

    test("should handle topic with only spaces 400", async () => {
      const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "   ", count: 5 });
      expect(res.status).toBe(400);
    });
  });

  // ========== COMPETE CODING CONTEST BRUTAL ==========
  describe("POST /api/compete/create — Coding Contest", () => {
    test("should create QUIZ lobby valid", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ", difficulty: "Medium", questionCount: 5 });
      expect(res.status).toBe(201);
      expect(res.body.lobby.pin).toMatch(/^\d{6}$/);
      expect(res.body.lobby.quizData).toBeDefined();
      validateQuiz(res.body.lobby.quizData, 5, "Arrays");
      expect(res.body.lobby.players.length).toBe(1);
      expect(res.body.lobby.players[0].isHost).toBe(true);
    });

    test("should create CP lobby valid — coding contest", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Graphs", mode: "CP", difficulty: "Hard", questionCount: 3 });
      expect(res.status).toBe(201);
      expect(res.body.lobby.pin).toMatch(/^\d{6}$/);
      expect(res.body.lobby.mode).toBe("CP");
      validateCP(res.body.lobby.cpData, "Graphs");
    });

    test("should handle custom timeLimitSeconds", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "DP", mode: "QUIZ", questionCount: 5, timeLimitSeconds: 30 });
      expect(res.status).toBe(201);
      res.body.lobby.quizData.forEach(q => expect(q.timeLimitSeconds).toBe(30));
    });

    test("should cap timeLimitSeconds 5-60", async () => {
      const resLow = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ", timeLimitSeconds: 1 });
      expect(resLow.status).toBe(201);
      resLow.body.lobby.quizData.forEach(q => expect(q.timeLimitSeconds).toBeGreaterThanOrEqual(5));

      const resHigh = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ", timeLimitSeconds: 1000 });
      expect(resHigh.status).toBe(201);
      resHigh.body.lobby.quizData.forEach(q => expect(q.timeLimitSeconds).toBeLessThanOrEqual(60));
    });

    test("should reject missing topic 400", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ mode: "QUIZ" });
      expect(res.status).toBe(400);
    });

    test("should reject missing mode 400", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays" });
      expect(res.status).toBe(400);
    });

    test("should reject invalid mode 400", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "INVALID" });
      expect(res.status).toBe(400);
    });

    test("should handle XSS topic", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "<script>alert(1)</script>", mode: "QUIZ" });
      expect(res.status).not.toBe(500);
      expect([201,400]).toContain(res.status);
      if (res.status === 201) expect(res.body.lobby.topic).toBeDefined();
    });

    test("should handle huge topic 5000", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "A".repeat(5000), mode: "QUIZ" });
      expect(res.status).not.toBe(500);
      expect([201,400]).toContain(res.status);
    });

    test("should handle huge questionCount 100000 capped to 20", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ", questionCount: 100000 });
      expect(res.status).toBe(201);
      expect(res.body.lobby.quizData.length).toBeLessThanOrEqual(20);
      expect(res.body.lobby.questionCount).toBeLessThanOrEqual(20);
    });

    test("should handle questionCount 0 fallback to 5", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ", questionCount: 0 });
      expect(res.status).toBe(201);
      expect(res.body.lobby.quizData.length).toBeGreaterThanOrEqual(3);
    });

    test("should handle invalid difficulty fallback", async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ", difficulty: "Impossible" });
      expect(res.status).toBe(201);
      expect(["Easy","Medium","Hard","Mixed"]).toContain(res.body.lobby.difficulty);
    });

    test("should handle concurrent 20 lobby creations PIN unique (1Lakh scale)", async () => {
      const promises = Array.from({ length: 20 }, () => 
        request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ", questionCount: 5 })
      );
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(201));
      const pins = results.map(r => r.body.lobby.pin);
      expect(new Set(pins).size).toBe(20);
      // Validate each quiz
      results.forEach(r => validateQuiz(r.body.lobby.quizData, 5, "Arrays"));
    });

    test("should handle concurrent 10 CP lobbies", async () => {
      const promises = Array.from({ length: 10 }, () => 
        request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Graphs", mode: "CP", difficulty: "Hard" })
      );
      const results = await Promise.all(promises);
      results.forEach(r => {
        expect(r.status).toBe(201);
        validateCP(r.body.lobby.cpData, "Graphs");
      });
    });
  });

  describe("POST /api/compete/join — Join Contest", () => {
    let pin;
    beforeEach(async () => {
      const res = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ" });
      pin = res.body.lobby.pin;
    });

    test("should join valid PIN", async () => {
      const recruiter2 = await createTestUser({ email: `join-${Date.now()}@ex.com`, role: "seeker" });
      const token = getAuthToken(recruiter2);
      const res = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${token}`).send({ pin });
      expect(res.status).toBe(200);
      expect(res.body.lobby.players.length).toBe(2);
    });

    test("should reject missing PIN 400", async () => {
      const res = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${seekerToken}`).send({});
      expect(res.status).toBe(400);
    });

    test("should reject invalid PIN format 400", async () => {
      const res = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${seekerToken}`).send({ pin: "abc" });
      expect(res.status).toBe(400);
    });

    test("should reject non-existent PIN 404", async () => {
      const res = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${seekerToken}`).send({ pin: "000000" });
      expect(res.status).toBe(404);
    });

    test("should handle already joined (idempotent)", async () => {
      const res1 = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${seekerToken}`).send({ pin });
      expect(res1.status).toBe(200);
      const res2 = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${seekerToken}`).send({ pin });
      expect(res2.status).toBe(200);
      // Should not duplicate
      const lobby = await CompetitionLobby.findOne({ pin });
      const count = lobby.players.filter(p => String(p.userId) === String(seeker._id)).length;
      expect(count).toBe(1);
    });

    test("should reject join after started 400", async () => {
      await CompetitionLobby.findOneAndUpdate({ pin }, { status: "PLAYING" });
      const newUser = await createTestUser({ email: `late-${Date.now()}@ex.com`, role: "seeker" });
      const token = getAuthToken(newUser);
      const res = await request(app).post("/api/compete/join").set("Authorization", `Bearer ${token}`).send({ pin });
      expect(res.status).toBe(400);
    });

    test("should handle concurrent 10 joins no duplicates (1Lakh scale)", async () => {
      const users = await Promise.all(Array.from({ length: 10 }, async () => {
        const u = await createTestUser({ email: `conc-${Date.now()}-${Math.random()}@ex.com`, role: "seeker" });
        return u;
      }));
      const promises = users.map(u => {
        const token = getAuthToken(u);
        return request(app).post("/api/compete/join").set("Authorization", `Bearer ${token}`).send({ pin });
      });
      const results = await Promise.all(promises);
      results.forEach(r => expect(r.status).toBe(200));
      const lobby = await CompetitionLobby.findOne({ pin });
      expect(lobby.players.length).toBe(11); // 1 host + 10
      const ids = lobby.players.map(p => String(p.userId));
      expect(new Set(ids).size).toBe(ids.length);
    });

    test("should handle unauthenticated 401", async () => {
      const res = await request(app).post("/api/compete/join").send({ pin });
      expect([401,403]).toContain(res.status);
    });
  });

  describe("GET /api/compete/:id — Get Lobby", () => {
    test("should get valid lobby", async () => {
      const create = await request(app).post("/api/compete/create").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", mode: "QUIZ" });
      const res = await request(app).get(`/api/compete/${create.body.lobby._id}`).set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.lobby.pin).toBeDefined();
    });

    test("should 404 invalid id", async () => {
      const res = await request(app).get("/api/compete/507f1f77bcf86cd799439011").set("Authorization", `Bearer ${seekerToken}`);
      expect(res.status).toBe(404);
    });

    test("should 400 invalid format", async () => {
      const res = await request(app).get("/api/compete/invalid").set("Authorization", `Bearer ${seekerToken}`);
      expect([400,500]).toContain(res.status);
    });
  });

  // ========== QUIZ SESSION FLOW (Take Quiz) ==========
  describe("Take Quiz Flow — Learn Session QUIZ", () => {
    test("should start QUIZ session with quizData and complete with score", async () => {
      // Generate quiz
      const gen = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", difficulty: "Medium", count: 5 });
      expect(gen.status).toBe(200);
      validateQuiz(gen.body.quiz, 5, "Arrays");

      // Start session
      const start = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 10, quizData: gen.body.quiz });
      expect(start.status).toBe(201);
      expect(start.body.quizData).toBeDefined();
      expect(start.body.quizData.length).toBe(5);

      // Complete with score
      const complete = await request(app).post(`/api/learn/session/${start.body._id}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({ score: 80 });
      expect(complete.status).toBe(200);
      expect(complete.body.session.status).toBe("COMPLETED");
      expect(complete.body.pointsAwarded).toBe(80);
    });

    test("should handle quiz with all difficulties", async () => {
      for (const diff of ["Easy", "Medium", "Hard"]) {
        const gen = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Graphs", difficulty: diff, count: 3 });
        expect(gen.status).toBe(200);
        validateQuiz(gen.body.quiz, 3, "Graphs");
        const start = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "QUIZ", topic: "Graphs", durationMinutes: 10, quizData: gen.body.quiz });
        expect(start.status).toBe(201);
        const score = diff === "Easy" ? 90 : diff === "Medium" ? 70 : 50;
        const complete = await request(app).post(`/api/learn/session/${start.body._id}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({ score });
        expect(complete.status).toBe(200);
      }
    });

    test("should handle quiz stress: ask 20 questions sequentially and check quiz quality", async () => {
      const topics = ["Arrays", "Linked Lists", "Trees", "Graphs", "DP", "System Design", "OS", "DBMS", "Networking", "OOP"];
      for (let i = 0; i < 20; i++) {
        const topic = topics[i % topics.length];
        const res = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic, difficulty: "Medium", count: 5 });
        expect(res.status).toBe(200);
        validateQuiz(res.body.quiz, 5, topic);
        // Check quiz is not generic: each question should mention topic or be distinct
        const questions = res.body.quiz.map(q => q.question);
        const unique = new Set(questions);
        expect(unique.size).toBe(5);
        // Check no XSS in questions
        res.body.quiz.forEach(q => {
          expect(q.question).not.toMatch(/<script>/i);
          q.options.forEach(opt => expect(opt).not.toMatch(/<script>/i));
        });
      }
    });

    test("should handle concurrent quiz sessions 10 (1Lakh scale)", async () => {
      const genPromises = Array.from({ length: 10 }, () => 
        request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", count: 5 })
      );
      const gens = await Promise.all(genPromises);
      gens.forEach(g => {
        expect(g.status).toBe(200);
        validateQuiz(g.body.quiz, 5, "Arrays");
      });
      const startPromises = gens.map(g => 
        request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 10, quizData: g.body.quiz })
      );
      const starts = await Promise.all(startPromises);
      starts.forEach(s => expect(s.status).toBe(201));
      const completePromises = starts.map(s => 
        request(app).post(`/api/learn/session/${s.body._id}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({ score: 75 })
      );
      const completes = await Promise.all(completePromises);
      completes.forEach(c => expect(c.status).toBe(200));
    });

    test("should handle quiz with score 0 and 100 boundaries", async () => {
      const gen = await request(app).post("/api/learn/generate-quiz").set("Authorization", `Bearer ${seekerToken}`).send({ topic: "Arrays", count: 3 });
      const start1 = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 10, quizData: gen.body.quiz });
      const c1 = await request(app).post(`/api/learn/session/${start1.body._id}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({ score: 0 });
      expect(c1.status).toBe(200);
      expect(c1.body.pointsAwarded).toBe(0);

      const start2 = await request(app).post("/api/learn/session").set("Authorization", `Bearer ${seekerToken}`).send({ type: "QUIZ", topic: "Arrays", durationMinutes: 10, quizData: gen.body.quiz });
      const c2 = await request(app).post(`/api/learn/session/${start2.body._id}/complete`).set("Authorization", `Bearer ${seekerToken}`).send({ score: 100 });
      expect(c2.status).toBe(200);
      expect(c2.body.pointsAwarded).toBe(100);
    });
  });
});
