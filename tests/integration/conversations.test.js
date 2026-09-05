const request = require("supertest");
const app = require("../../src/app");
const Application = require("../../src/models/Application");
const Message = require("../../src/models/Message");
const { createTestUser, createTestRecruiter, getAuthToken, createTestJob } = require("../utils/helpers");

describe("Conversations API Integration Tests", () => {
  let recruiter, seeker, job, application;

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
  });

  describe("GET /api/messages/conversations", () => {
    it("should return user conversation threads with unread count and latest message", async () => {
      // Send a message from seeker to recruiter
      await Message.create({
        application: application._id,
        sender: seeker._id,
        recipient: recruiter._id,
        text: "Hi recruiter, I am excited about this role!",
      });

      // Recruiter checks conversations inbox
      const res = await request(app)
        .get("/api/messages/conversations")
        .set("Authorization", `Bearer ${getAuthToken(recruiter)}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);

      const conv = res.body[0];
      expect(conv.applicationId).toBe(String(application._id));
      expect(conv.counterpart.name).toBe(seeker.name);
      expect(conv.counterpart.role).toBe("seeker");
      expect(conv.lastMessage.text).toBe("Hi recruiter, I am excited about this role!");
      expect(conv.unreadCount).toBe(1);
    });

    it("should return unread count 0 for the sender of the last message", async () => {
      await Message.create({
        application: application._id,
        sender: seeker._id,
        recipient: recruiter._id,
        text: "Hi recruiter!",
      });

      // Seeker checks conversations inbox (they sent it, so unreadCount for seeker is 0)
      const res = await request(app)
        .get("/api/messages/conversations")
        .set("Authorization", `Bearer ${getAuthToken(seeker)}`);

      expect(res.statusCode).toBe(200);
      expect(res.body[0].unreadCount).toBe(0);
      expect(res.body[0].counterpart.name).toBe(recruiter.name);
    });
  });

  describe("PATCH /api/messages/application/:applicationId/read", () => {
    it("should mark all unread messages as read in the conversation", async () => {
      const msg = await Message.create({
        application: application._id,
        sender: seeker._id,
        recipient: recruiter._id,
        text: "Important update!",
        readAt: null,
      });

      const res = await request(app)
        .patch(`/api/messages/application/${application._id}/read`)
        .set("Authorization", `Bearer ${getAuthToken(recruiter)}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);

      const updated = await Message.findById(msg._id);
      expect(updated.readAt).not.toBeNull();
    });
  });
});
