const request = require("supertest");
const app = require("../../src/app");
const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");
const InterviewInvite = require("../../src/models/InterviewInvite");
const { getAuthToken } = require("../utils/helpers");

describe("Interview Invite and Canonical Membership Integration", () => {
  let recruiter;
  let seeker;
  let outsider;
  let recruiterToken;
  let seekerToken;
  let outsiderToken;
  let session;

  beforeEach(async () => {
    recruiter = await User.create({
      name: "Lead Recruiter",
      email: "recruiter-invite@example.com",
      password: "password123",
      role: "recruiter",
    });

    seeker = await User.create({
      name: "Candidate One",
      email: "candidate-invite@example.com",
      password: "password123",
      role: "seeker",
    });

    outsider = await User.create({
      name: "Malicious Outsider",
      email: "outsider-invite@example.com",
      password: "password123",
      role: "seeker",
    });

    recruiterToken = getAuthToken(recruiter);
    seekerToken = getAuthToken(seeker);
    outsiderToken = getAuthToken(outsider);

    const job = await Job.create({
      title: "Senior Full Stack Engineer",
      company: "Tech Corp",
      recruiter: recruiter._id,
      description: "Job description with minimum length requirements satisfied",
      requirements: ["React", "Node.js"],
      skillsRequired: ["javascript"],
    });

    const application = await Application.create({
      job: job._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      status: "shortlisted",
    });

    session = await InterviewSession.create({
      tenantId: "default",
      application: application._id,
      job: job._id,
      seeker: seeker._id,
      recruiter: recruiter._id,
      title: "Technical Architecture Round",
      roomKey: "room-invite-test-101",
      status: "SCHEDULED",
      stage: "WAITING_ROOM",
      scheduledStart: new Date(Date.now() + 1000 * 60 * 60 * 24),
      allowedLanguages: ["javascript", "python"],
    });
  });

  it("allows lead recruiter to generate authenticated invite URL", async () => {
    const res = await request(app)
      .post(`/api/interviews/${session._id}/invites`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({ audienceUserId: seeker._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.rawToken).toBeDefined();
    expect(res.body.inviteUrl).toContain("/join/interview/");
  });

  it("prevents candidate or non-lead user from generating invites", async () => {
    const res = await request(app)
      .post(`/api/interviews/${session._id}/invites`)
      .set("Authorization", `Bearer ${seekerToken}`)
      .send({ audienceUserId: seeker._id.toString() });

    expect(res.status).toBe(403);
  });

  it("validates an active invite without consuming it", async () => {
    const createRes = await request(app)
      .post(`/api/interviews/${session._id}/invites`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({ audienceUserId: seeker._id.toString() });

    const rawToken = createRes.body.rawToken;

    const valRes = await request(app)
      .get(`/api/interviews/invites/validate/${rawToken}`)
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(valRes.status).toBe(200);
    expect(valRes.body.valid).toBe(true);
    expect(valRes.body.session.title).toBe("Technical Architecture Round");
  });

  it("allows the assigned candidate to accept and exchange the invite token", async () => {
    const createRes = await request(app)
      .post(`/api/interviews/${session._id}/invites`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({ audienceUserId: seeker._id.toString() });

    const rawToken = createRes.body.rawToken;

    const acceptRes = await request(app)
      .post(`/api/interviews/invites/accept/${rawToken}`)
      .set("Authorization", `Bearer ${seekerToken}`);

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.roomKey).toBe("room-invite-test-101");
  });

  it("rejects when an unassigned outsider attempts to exchange candidate invite", async () => {
    const createRes = await request(app)
      .post(`/api/interviews/${session._id}/invites`)
      .set("Authorization", `Bearer ${recruiterToken}`)
      .send({ audienceUserId: seeker._id.toString() });

    const rawToken = createRes.body.rawToken;

    const acceptRes = await request(app)
      .post(`/api/interviews/invites/accept/${rawToken}`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(acceptRes.status).toBe(403);
    expect(acceptRes.body.msg).toContain("assigned to a different user account");
  });
});
