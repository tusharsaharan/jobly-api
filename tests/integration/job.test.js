const request = require("supertest");
const app = require("../../src/app");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const { createTestUser, createTestRecruiter, getAuthToken, createTestJob } = require("../utils/helpers");

describe("Job API Integration Tests", () => {
  describe("POST /api/jobs", () => {
    it("should allow a recruiter to post a new job", async () => {
      const recruiter = await createTestRecruiter();
      const token = getAuthToken(recruiter);

      const jobData = {
        title: "Staff Frontend Engineer",
        company: "Vercel",
        description: "We are looking for a staff level engineer to lead the next generation of Vite tooling.",
        skills: ["React", "TypeScript", "Vite", "Rust"],
        location: "Remote",
        type: "Full-time",
        atsRequirements: {
          minCgpa: 8.0,
          targetCollegeTier: "tier1",
          minExperienceYears: 5,
          requiredDegree: "B.Tech"
        }
      };

      const res = await request(app)
        .post("/api/jobs")
        .set("Authorization", `Bearer ${token}`)
        .send(jobData);

      expect(res.statusCode).toBe(201);
      expect(res.body._id).toBeTruthy();
      expect(res.body.title).toBe(jobData.title);
      expect(res.body.recruiter.toString()).toBe(recruiter._id.toString());
    });

    it("should forbid seekers from posting a job", async () => {
      const seeker = await createTestUser();
      const token = getAuthToken(seeker);

      const res = await request(app)
        .post("/api/jobs")
        .set("Authorization", `Bearer ${token}`)
        .send({
          title: "Invalid Job",
          description: "This job should fail to post."
        });

      expect(res.statusCode).toBe(403);
    });

    it("should reject job details failing validation", async () => {
      const recruiter = await createTestRecruiter();
      const token = getAuthToken(recruiter);

      const res = await request(app)
        .post("/api/jobs")
        .set("Authorization", `Bearer ${token}`)
        .send({
          title: "S", // Too short
          description: "Short description"
        });

      expect(res.statusCode).toBe(422);
    });
  });

  describe("GET /api/jobs", () => {
    it("should return own jobs only for recruiters", async () => {
      const recruiter1 = await createTestRecruiter();
      const recruiter2 = await createTestRecruiter();
      const seeker = await createTestUser();

      const job = await createTestJob(recruiter1._id, { title: "Job A" });
      await createTestJob(recruiter2._id, { title: "Job B" });
      await Application.create({
        job: job._id,
        seeker: seeker._id,
        recruiter: recruiter1._id,
        status: "shortlisted",
      });

      const res = await request(app)
        .get("/api/jobs")
        .set("Authorization", `Bearer ${getAuthToken(recruiter1)}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].title).toBe("Job A");
      expect(res.body[0].applicationCount).toBe(1);
      expect(res.body[0].shortlistedCount).toBe(1);
    });

    it("should return all jobs for seekers", async () => {
      const recruiter = await createTestRecruiter();
      const seeker = await createTestUser();

      await createTestJob(recruiter._id, { title: "Job A" });
      await createTestJob(recruiter._id, { title: "Job B" });

      const res = await request(app)
        .get("/api/jobs")
        .set("Authorization", `Bearer ${getAuthToken(seeker)}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(2);
    });
  });

  describe("GET /api/jobs/match", () => {
    it("should return every posted job, ranked with eligible jobs first", async () => {
      const recruiter = await createTestRecruiter();
      const seeker = await createTestUser({
        skills: ["nodejs", "react"],
        cgpa: 8.5,
        collegeTier: "tier1"
      });

      // Perfect match
      await createTestJob(recruiter._id, {
        title: "Node & React Developer",
        skills: ["nodejs", "react"],
        atsRequirements: { minCgpa: 8.0 }
      });

      // Seeker doesn't meet ATS requirement (CGPA too low)
      await createTestJob(recruiter._id, {
        title: "High CGPA Node Developer",
        skills: ["nodejs"],
        atsRequirements: { minCgpa: 9.0 }
      });

      const res = await request(app)
        .get("/api/jobs/match")
        .set("Authorization", `Bearer ${getAuthToken(seeker)}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body[0].title).toBe("Node & React Developer");
      expect(res.body[0].score).toBe(100);
      expect(res.body[0].eligible).toBe(true);
      expect(res.body[1].title).toBe("High CGPA Node Developer");
      expect(res.body[1].eligible).toBe(false);
      expect(res.body[1].eligibilityReasons).toContain("Requires a CGPA of 9 or higher.");
    });
  });
});
