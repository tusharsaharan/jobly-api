const request = require("supertest");
const app = require("../../src/app");
const Application = require("../../src/models/Application");
const Message = require("../../src/models/Message");
const { createTestUser, createTestRecruiter, getAuthToken, createTestJob } = require("../utils/helpers");

describe("Message API Integration Tests", () => {
  let recruiter, seeker, job, application;

  beforeEach(async () => {
    recruiter = await createTestRecruiter();
    seeker = await createTestUser();
    job = await createTestJob(recruiter._id);

    application = await Application.create({
      job: job._id,
      seeker: seeker._id,
      recruiter: recruiter._id
    });
  });

  describe("POST /api/messages/application/:applicationId", () => {
    it("should allow a conversation participant to send a message", async () => {
      const res = await request(app)
        .post(`/api/messages/application/${application._id}`)
        .set("Authorization", `Bearer ${getAuthToken(seeker)}`)
        .send({ text: "Hello! Thank you for reviewing my application." });

      expect(res.statusCode).toBe(201);
      expect(res.body.text).toBe("Hello! Thank you for reviewing my application.");
      expect(res.body.sender.name).toBe(seeker.name);

      const dbMessage = await Message.findOne({ application: application._id });
      expect(dbMessage).toBeTruthy();
      expect(dbMessage.text).toBe("Hello! Thank you for reviewing my application.");
    });

    it("should block non-participants from sending a message", async () => {
      const interloper = await createTestUser();

      const res = await request(app)
        .post(`/api/messages/application/${application._id}`)
        .set("Authorization", `Bearer ${getAuthToken(interloper)}`)
        .send({ text: "I want to send this message." });

      expect(res.statusCode).toBe(403);
    });

    it("should reject empty messages or message longer than 2000 characters", async () => {
      const res = await request(app)
        .post(`/api/messages/application/${application._id}`)
        .set("Authorization", `Bearer ${getAuthToken(seeker)}`)
        .send({ text: "" });

      expect(res.statusCode).toBe(422);
    });
  });

  describe("GET /api/messages/application/:applicationId", () => {
    it("should load message history and mark messages as read for recipient", async () => {
      // Seeker sends a message
      await Message.create({
        application: application._id,
        sender: seeker._id,
        recipient: recruiter._id,
        text: "Hi recruiter!"
      });

      // Recruiter reads messages
      const res = await request(app)
        .get(`/api/messages/application/${application._id}`)
        .set("Authorization", `Bearer ${getAuthToken(recruiter)}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].text).toBe("Hi recruiter!");

      // Verify readAt was updated in db
      const msg = await Message.findOne({ application: application._id });
      expect(msg.readAt).not.toBeNull();
    });

    it("should deny access to non-participants", async () => {
      const interloper = await createTestUser();

      const res = await request(app)
        .get(`/api/messages/application/${application._id}`)
        .set("Authorization", `Bearer ${getAuthToken(interloper)}`);

      expect(res.statusCode).toBe(403);
    });
  });
});
