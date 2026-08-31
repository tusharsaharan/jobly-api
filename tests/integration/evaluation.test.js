const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = require("../../src/app");
const config = require("../../src/config/env");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const TimelineEvent = require("../../src/models/TimelineEvent");
const CodeCheckpoint = require("../../src/models/CodeCheckpoint");
const Evaluation = require("../../src/models/Evaluation");

describe("Feature 7: Evidence Engine & Evaluation System", () => {
  let seekerUser;
  let recruiterUser;
  let outsiderUser;
  let sessionDoc;
  let seekerToken;
  let recruiterToken;
  let outsiderToken;
  let roomKey;
  let timelineEv;
  let checkpointDoc;

  beforeEach(async () => {
    seekerUser = await User.create({
      name: "Seeker Dev",
      email: `seeker_eval_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_eval",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_eval_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_eval",
    });

    outsiderUser = await User.create({
      name: "Outsider User",
      email: `outsider_eval_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_eval",
    });

    const jobDoc = await Job.create({
      title: "Senior Cloud Engineer",
      description: "Looking for principal engineer.",
      company: "Scalable Systems",
      recruiter: recruiterUser._id,
      tenantId: "tenant_eval",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_eval",
    });

    roomKey = `room-eval-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_eval",
      application: appDoc._id,
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      roomKey,
      scheduledStart: new Date(),
      status: "LIVE",
    });

    seekerToken = jwt.sign(
      { id: seekerUser._id.toString(), userId: seekerUser._id.toString(), role: "seeker" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    recruiterToken = jwt.sign(
      { id: recruiterUser._id.toString(), userId: recruiterUser._id.toString(), role: "recruiter" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    outsiderToken = jwt.sign(
      { id: outsiderUser._id.toString(), userId: outsiderUser._id.toString(), role: "recruiter" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    // Create verified artifacts to link as evidence
    timelineEv = await TimelineEvent.create({
      session: sessionDoc._id,
      pipeline: "CODING",
      eventType: "code.execution",
      offsetMs: 3000,
      participant: seekerUser._id,
      payload: { codeSnippet: "def solution(): return 1", exitCode: 0 },
    });

    checkpointDoc = await CodeCheckpoint.create({
      session: sessionDoc._id,
      triggerType: "MANUAL",
      triggerLabel: "Test Checkpoint",
      sequenceNumber: 1,
      filesSnapshot: [{ path: "/solution.py", name: "solution.py", content: "def solution(): return 1" }],
    });
  });

  test("Test 1: should save structured evaluation with verified evidence links", async () => {
    const res = await request(app)
      .post(`/api/evaluations/${sessionDoc._id}`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({
        overallRating: 5,
        decision: "STRONG_HIRE",
        competencies: [
          {
            category: "Coding & Algorithms",
            score: 5,
            notes: "Outstanding algorithmic efficiency",
            evidenceRefs: [
              {
                refType: "TIMELINE_EVENT",
                timelineEventId: timelineEv._id,
                quote: "Candidate executed optimal solution",
              },
            ],
          },
        ],
        strengths: ["Fast implementation", "Strong problem comprehension"],
        weaknesses: ["None observed"],
      });

    expect(res.status).toBe(201);
    expect(res.body.evaluation.decision).toBe("STRONG_HIRE");
    expect(res.body.evaluation.overallRating).toBe(5);

    // Assert session auto-transitions to COMPLETED
    const updatedSession = await InterviewSession.findById(sessionDoc._id);
    expect(updatedSession.status).toBe("COMPLETED");
  });

  test("Test 2: should reject evaluation if competency is missing evidence references", async () => {
    const res = await request(app)
      .post(`/api/evaluations/${sessionDoc._id}`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({
        overallRating: 4,
        decision: "HIRE",
        competencies: [
          {
            category: "System Design",
            score: 4,
            notes: "Good architecture",
            evidenceRefs: [], // Missing evidence!
          },
        ],
      });

    expect(res.status).toBe(400);
    const errorText = JSON.stringify(res.body);
    expect(errorText).toContain("at least one verifiable evidence link");
  });

  test("Test 3: should reject evaluation with fabricated or non-existent evidence IDs", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post(`/api/evaluations/${sessionDoc._id}`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({
        overallRating: 4,
        decision: "HIRE",
        competencies: [
          {
            category: "Algorithms",
            score: 4,
            evidenceRefs: [
              {
                refType: "TIMELINE_EVENT",
                timelineEventId: fakeId,
              },
            ],
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.msg).toContain("Invalid evidence link");
  });

  test("Test 4: should retrieve and resolve evidence reference to its raw underlying artifact", async () => {
    const createRes = await request(app)
      .post(`/api/evaluations/${sessionDoc._id}`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({
        overallRating: 4,
        decision: "HIRE",
        competencies: [
          {
            category: "Problem Solving",
            score: 4,
            evidenceRefs: [
              {
                refType: "CODE_CHECKPOINT",
                checkpointId: checkpointDoc._id,
              },
            ],
          },
        ],
      });

    const evidenceId = createRes.body.evaluation.competencies[0].evidenceRefs[0]._id;

    const resolveRes = await request(app)
      .get(`/api/evaluations/${sessionDoc._id}/evidence/${evidenceId}`)
      .set("Authorization", `Bearer ${recruiterToken}`);

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.resolvedArtifact).not.toBeNull();
    expect(resolveRes.body.resolvedArtifact.triggerLabel).toBe("Test Checkpoint");
  });

  test("Test 5: should reject non-recruiters from creating or reading evaluations", async () => {
    const res = await request(app)
      .post(`/api/evaluations/${sessionDoc._id}`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({ overallRating: 5, decision: "HIRE" });

    expect(res.status).toBe(403);
  });

  test("Test 6: should return candidate-safe coaching feedback without private hiring notes", async () => {
    await Evaluation.create({
      session: sessionDoc._id,
      evaluator: recruiterUser._id,
      overallRating: 3,
      decision: "NO_HIRE",
      strengths: ["Clear communication"],
      weaknesses: ["Practice explaining trade-offs before coding"],
      privateNotes: "Do not disclose this hiring-panel calibration note.",
      aiInsights: { internalSummary: "Not candidate visible" },
      competencies: [
        {
          category: "System Design",
          score: 3,
          notes: "State scaling assumptions earlier.",
          evidenceRefs: [
            {
              refType: "TIMELINE_EVENT",
              timelineEventId: timelineEv._id,
              quote: "Candidate design discussion",
            },
          ],
        },
      ],
    });

    const feedbackRes = await request(app)
      .get(`/api/evaluations/${sessionDoc._id}/candidate-feedback`)
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(feedbackRes.status).toBe(200);
    expect(feedbackRes.body.feedback.improvementAreas).toEqual([
      "Practice explaining trade-offs before coding",
    ]);
    expect(feedbackRes.body.feedback.competencies[0]).toEqual({
      category: "System Design",
      score: 3,
      notes: "State scaling assumptions earlier.",
    });
    expect(JSON.stringify(feedbackRes.body)).not.toContain("private hiring-panel");
    expect(JSON.stringify(feedbackRes.body)).not.toContain("internalSummary");

    const forbiddenRes = await request(app)
      .get(`/api/evaluations/${sessionDoc._id}/candidate-feedback`)
      .set("Authorization", `Bearer ${outsiderToken}`);
    expect(forbiddenRes.status).toBe(403);
  });
});
