const request = require("supertest");
const app = require("../../src/app");
const Application = require("../../src/models/Application");
const { createTestUser, createTestRecruiter, getAuthToken, createTestJob } = require("../utils/helpers");

describe("Application API Integration Tests", () => {
  describe("POST /api/applications/:jobId", () => {
    it("should allow a seeker to apply to a job if they meet ATS requirements and have uploaded resume", async () => {
      const recruiter = await createTestRecruiter();
      const job = await createTestJob(recruiter._id, {
        atsRequirements: { minCgpa: 8.0 }
      });

      const seeker = await createTestUser({
        resumeText: "Experienced engineer. B.Tech Computer Science degree holder.",
        cgpa: 8.5
      });
      const token = getAuthToken(seeker);

      const res = await request(app)
        .post(`/api/applications/${job._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.atsScore).toBe(85); // Mocked response score from setup.js
      expect(res.body.status).toBe("applied");
    });

    it("should forbid applying to your own job", async () => {
      const recruiter = await createTestRecruiter();
      const job = await createTestJob(recruiter._id);

      const res = await request(app)
        .post(`/api/applications/${job._id}`)
        .set("Authorization", `Bearer ${getAuthToken(recruiter)}`);

      expect(res.statusCode).toBe(403);
    });

    it("should forbid applying if seeker has not uploaded resumeText", async () => {
      const recruiter = await createTestRecruiter();
      const job = await createTestJob(recruiter._id);
      const seeker = await createTestUser({ resumeText: "" }); // No resume

      const res = await request(app)
        .post(`/api/applications/${job._id}`)
        .set("Authorization", `Bearer ${getAuthToken(seeker)}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.msg).toBe("Please upload your resume before applying.");
    });

    it("should forbid applying if seeker fails ATS requirements", async () => {
      const recruiter = await createTestRecruiter();
      const job = await createTestJob(recruiter._id, {
        atsRequirements: { minCgpa: 9.0 }
      });
      const seeker = await createTestUser({
        resumeText: "Resume text",
        cgpa: 8.0
      });

      const res = await request(app)
        .post(`/api/applications/${job._id}`)
        .set("Authorization", `Bearer ${getAuthToken(seeker)}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.msg).toBe("Your profile does not meet this role's required criteria.");
    });
  });

  describe("PATCH /api/applications/:applicationId/status", () => {
    it("should allow a recruiter to shortlist or reject an applicant", async () => {
      const recruiter = await createTestRecruiter();
      const seeker = await createTestUser();
      const job = await createTestJob(recruiter._id);

      const appInstance = await Application.create({
        job: job._id,
        seeker: seeker._id,
        recruiter: recruiter._id
      });

      const res = await request(app)
        .patch(`/api/applications/${appInstance._id}/status`)
        .set("Authorization", `Bearer ${getAuthToken(recruiter)}`)
        .send({ status: "shortlisted" });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("shortlisted");
    });

    it("should prevent unauthorized users/recruiters from modifying status", async () => {
      const recruiter1 = await createTestRecruiter();
      const recruiter2 = await createTestRecruiter();
      const seeker = await createTestUser();
      const job = await createTestJob(recruiter1._id);

      const appInstance = await Application.create({
        job: job._id,
        seeker: seeker._id,
        recruiter: recruiter1._id
      });

      const res = await request(app)
        .patch(`/api/applications/${appInstance._id}/status`)
        .set("Authorization", `Bearer ${getAuthToken(recruiter2)}`)
        .send({ status: "shortlisted" });

      expect(res.statusCode).toBe(403);
    });
  });
});
