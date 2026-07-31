const mongoose = require("mongoose");
const InterviewSession = require("../../src/models/InterviewSession");
const InterviewProblem = require("../../src/models/InterviewProblem");
const TimelineEvent = require("../../src/models/TimelineEvent");
const InterviewScorecard = require("../../src/models/InterviewScorecard");

describe("Phase 1: Interview Domain Models & State Machine", () => {
  const dummySeekerId = new mongoose.Types.ObjectId();
  const dummyRecruiterId = new mongoose.Types.ObjectId();
  const dummyJobId = new mongoose.Types.ObjectId();
  const dummyAppId = new mongoose.Types.ObjectId();

  describe("InterviewSession State Machine & Transitions", () => {
    it("should instantiate with default SCHEDULED status and WAITING_ROOM stage", async () => {
      const session = new InterviewSession({
        application: dummyAppId,
        job: dummyJobId,
        seeker: dummySeekerId,
        recruiter: dummyRecruiterId,
        scheduledStart: new Date(Date.now() + 3600000),
        roomKey: `room-${Date.now()}`,
      });

      expect(session.status).toBe("SCHEDULED");
      expect(session.stage).toBe("WAITING_ROOM");
      expect(session.allowedLanguages).toContain("python");
      expect(session.allowedLanguages).toContain("javascript");
      expect(session.allowedLanguages).toContain("cpp");
    });

    it("should allow valid status transitions: SCHEDULED -> WAITING_ROOM -> LIVE -> COMPLETED", () => {
      const session = new InterviewSession({
        application: dummyAppId,
        job: dummyJobId,
        seeker: dummySeekerId,
        recruiter: dummyRecruiterId,
        scheduledStart: new Date(),
        roomKey: `room-${Date.now()}-2`,
      });

      expect(session.canTransitionToStatus("WAITING_ROOM")).toBe(true);
      session.transitionStatus("WAITING_ROOM");
      expect(session.status).toBe("WAITING_ROOM");

      expect(session.canTransitionToStatus("LIVE")).toBe(true);
      session.transitionStatus("LIVE");
      expect(session.status).toBe("LIVE");
      expect(session.actualStart).toBeInstanceOf(Date);

      expect(session.canTransitionToStatus("COMPLETED")).toBe(true);
      session.transitionStatus("COMPLETED");
      expect(session.status).toBe("COMPLETED");
      expect(session.stage).toBe("COMPLETED");
      expect(session.actualEnd).toBeInstanceOf(Date);
    });

    it("should reject invalid terminal status transitions (COMPLETED -> LIVE)", () => {
      const session = new InterviewSession({
        application: dummyAppId,
        job: dummyJobId,
        seeker: dummySeekerId,
        recruiter: dummyRecruiterId,
        scheduledStart: new Date(),
        roomKey: `room-${Date.now()}-3`,
        status: "COMPLETED",
      });

      expect(session.canTransitionToStatus("LIVE")).toBe(false);
      expect(() => session.transitionStatus("LIVE")).toThrow(
        /Invalid status transition from COMPLETED to LIVE/
      );
    });

    it("should handle stage progression: INTRODUCTION -> CODING -> SYSTEM_DESIGN -> FEEDBACK", () => {
      const session = new InterviewSession({
        application: dummyAppId,
        job: dummyJobId,
        seeker: dummySeekerId,
        recruiter: dummyRecruiterId,
        scheduledStart: new Date(),
        roomKey: `room-${Date.now()}-4`,
        status: "WAITING_ROOM",
      });

      session.transitionStage("INTRODUCTION");
      expect(session.stage).toBe("INTRODUCTION");
      expect(session.status).toBe("LIVE");

      session.transitionStage("CODING");
      expect(session.stage).toBe("CODING");

      session.transitionStage("SYSTEM_DESIGN");
      expect(session.stage).toBe("SYSTEM_DESIGN");

      session.transitionStage("FEEDBACK");
      expect(session.stage).toBe("FEEDBACK");

      session.transitionStage("COMPLETED");
      expect(session.stage).toBe("COMPLETED");
      expect(session.status).toBe("COMPLETED");
    });

    it("should throw on invalid stage name", () => {
      const session = new InterviewSession({
        application: dummyAppId,
        job: dummyJobId,
        seeker: dummySeekerId,
        recruiter: dummyRecruiterId,
        scheduledStart: new Date(),
        roomKey: `room-${Date.now()}-5`,
      });

      expect(() => session.transitionStage("UNKNOWN_STAGE")).toThrow(/Invalid stage/);
    });
  });

  describe("InterviewProblem Model Validation", () => {
    it("should validate problem specification with test cases and starter code", () => {
      const problem = new InterviewProblem({
        title: "LRU Cache Design",
        difficulty: "Medium",
        category: "Data Structures",
        description: "Design a data structure that follows the constraints of a Least Recently Used (LRU) cache.",
        starterCode: {
          python: "class LRUCache:\n    def __init__(self, capacity: int):\n        pass",
          javascript: "class LRUCache {\n    constructor(capacity) {}\n}",
        },
        testCases: [
          { input: "LRUCache(2); put(1,1); get(1)", expectedOutput: "1", isHidden: false },
          { input: "put(2,2); put(3,3); get(1)", expectedOutput: "-1", isHidden: true },
        ],
        timeLimitMs: 2000,
        memoryLimitMb: 128,
      });

      const err = problem.validateSync();
      expect(err).toBeUndefined();
      expect(problem.testCases.length).toBe(2);
      expect(problem.difficulty).toBe("Medium");
    });
  });

  describe("TimelineEvent & InterviewScorecard Evidence Linking", () => {
    it("should record multi-pipeline timeline events with accurate offset", () => {
      const sessionId = new mongoose.Types.ObjectId();
      const event = new TimelineEvent({
        session: sessionId,
        pipeline: "CODING",
        eventType: "code.execution",
        offsetMs: 84300,
        participantRole: "seeker",
        payload: {
          executionId: "exec-9876",
          language: "python",
          exitCode: 0,
          durationMs: 142,
          codeSnippet: "def twoSum(nums, target): ...",
        },
      });

      const err = event.validateSync();
      expect(err).toBeUndefined();
      expect(event.pipeline).toBe("CODING");
      expect(event.offsetMs).toBe(84300);
    });

    it("should validate scorecard with linked evidence items", () => {
      const sessionId = new mongoose.Types.ObjectId();
      const timelineEventId = new mongoose.Types.ObjectId();

      const scorecard = new InterviewScorecard({
        session: sessionId,
        evaluator: dummyRecruiterId,
        hiringDecision: "STRONG_HIRE",
        overallNotes: "Exceptional mastery of hash maps, LRU design, and system scalability.",
        categories: [
          {
            category: "Coding & Algorithms",
            score: 5,
            notes: "Solved in O(1) time complexity using DoublyLinkedList + Map.",
            evidence: [
              {
                timelineEvent: timelineEventId,
                offsetMs: 84300,
                description: "Candidate converted O(N) lookup to O(1) using DoublyLinkedList pointer arithmetic.",
                artifactType: "CODE",
                artifactRef: "solution.py:L24-L52",
              },
            ],
          },
        ],
      });

      const err = scorecard.validateSync();
      expect(err).toBeUndefined();
      expect(scorecard.hiringDecision).toBe("STRONG_HIRE");
      expect(scorecard.categories[0].evidence[0].artifactType).toBe("CODE");
    });
  });
});
