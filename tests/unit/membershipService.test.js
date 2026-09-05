const { getMembership } = require("../../src/services/interviewMembershipService");
const { sessionOffsetMs } = require("../../src/services/interviewClock");
const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");

describe("Interview Membership Service & Interview Clock", () => {
  let recruiter;
  let seeker;
  let outsider;
  let session;

  beforeEach(async () => {
    recruiter = await User.create({
      name: "Lead Recruiter",
      email: "recruiter-membership@example.com",
      password: "password123",
      role: "recruiter",
    });

    seeker = await User.create({
      name: "Candidate",
      email: "candidate-membership@example.com",
      password: "password123",
      role: "seeker",
    });

    outsider = await User.create({
      name: "Outsider",
      email: "outsider-membership@example.com",
      password: "password123",
      role: "seeker",
    });

    const job = await Job.create({
      title: "Backend Engineer",
      company: "Tech Corp",
      recruiter: recruiter._id,
      description: "Job description for backend engineer position with real-time requirements",
      requirements: ["Node.js"],
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
      title: "Backend Architecture",
      roomKey: "room-membership-test-99",
      status: "LIVE",
      stage: "CODING",
      scheduledStart: new Date(),
      actualStart: new Date(Date.now() - 60000), // 1 min ago
      allowedLanguages: ["javascript"],
    });
  });

  describe("sessionOffsetMs", () => {
    it("calculates positive offset from actualStart", () => {
      const now = Date.now();
      const offset = sessionOffsetMs(session, now);
      expect(offset).toBeGreaterThanOrEqual(59000);
      expect(offset).toBeLessThanOrEqual(65000);
    });

    it("returns 0 if session is null or has no start time", () => {
      expect(sessionOffsetMs(null)).toBe(0);
      expect(sessionOffsetMs({}, 1000)).toBe(0);
    });
  });

  describe("getMembership", () => {
    it("authorizes recruiter with team & stage control capabilities", async () => {
      const result = await getMembership({
        sessionOrRoomKey: session.roomKey,
        userId: recruiter._id,
      });

      expect(result.role).toBe("recruiter");
      expect(result.isRecruiter).toBe(true);
      expect(result.isTeam).toBe(true);
      expect(result.capabilities.canControlStage).toBe(true);
      expect(result.capabilities.canEditCode).toBe(true);
    });

    it("authorizes seeker with candidate capabilities and restricts stage control", async () => {
      const result = await getMembership({
        sessionOrRoomKey: session._id.toString(),
        userId: seeker._id,
      });

      expect(result.role).toBe("seeker");
      expect(result.isSeeker).toBe(true);
      expect(result.isTeam).toBe(false);
      expect(result.capabilities.canControlStage).toBe(false);
      expect(result.capabilities.canEditCode).toBe(true);
    });

    it("throws 403 when outsider requests membership", async () => {
      await expect(
        getMembership({
          sessionOrRoomKey: session.roomKey,
          userId: outsider._id,
        })
      ).rejects.toThrow(/Access denied/);
    });

    it("enforces required capability check", async () => {
      await expect(
        getMembership({
          sessionOrRoomKey: session.roomKey,
          userId: seeker._id,
          requiredCapability: "canControlStage",
        })
      ).rejects.toThrow(/Missing required capability/);
    });
  });
});
