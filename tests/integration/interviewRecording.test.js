const request = require("supertest");
const app = require("../../src/app");
const InterviewSession = require("../../src/models/InterviewSession");
const Application = require("../../src/models/Application");
const { createTestUser, createTestRecruiter, getAuthToken, createTestJob } = require("../utils/helpers");

describe("Interview Recording API Integration Tests", () => {
  let recruiter, seeker, job, application, session;

  beforeEach(async () => {
    recruiter = await createTestRecruiter();
    seeker = await createTestUser();
    job = await createTestJob(recruiter._id);

    application = await Application.create({
      job: job._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      status: "shortlisted",
    });

    session = await InterviewSession.create({
      application: application._id,
      job: job._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      roomKey: `room-test-rec-${Date.now()}`,
      status: "COMPLETED",
      stage: "COMPLETED",
      title: "Technical System Design Interview",
      scheduledStart: new Date(),
    });
  });

  it("should upload a media recording file and update session.recordingUrl", async () => {
    const buffer = Buffer.from("RIFF....WEBMfakevideocontent12345");

    const res = await request(app)
      .post(`/api/interviews/${session._id}/recording`)
      .set("Authorization", `Bearer ${getAuthToken(recruiter)}`)
      .attach("video", buffer, "session-recording.webm");

    expect(res.statusCode).toBe(201);
    expect(res.body.recordingUrl).toBeDefined();
    expect(res.body.recordingUrl).toContain("/uploads/recordings/");

    const updatedSession = await InterviewSession.findById(session._id);
    expect(updatedSession.recordingUrl).toBe(res.body.recordingUrl);
  });

  it("should fetch recording details for an authorized session", async () => {
    session.recordingUrl = "/uploads/recordings/demo-session.webm";
    await session.save();

    const res = await request(app)
      .get(`/api/interviews/${session._id}/recording`)
      .set("Authorization", `Bearer ${getAuthToken(seeker)}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.recordingUrl).toBe("/uploads/recordings/demo-session.webm");
  });
});
