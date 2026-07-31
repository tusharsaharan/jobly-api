const request = require("supertest");
const app = require("../../src/app");
const User = require("../../src/models/User");
const { createTestUser, getAuthToken } = require("../utils/helpers");

describe("Auth API Integration Tests", () => {
  describe("POST /api/auth/register", () => {
    it("should successfully register a seeker", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Test Seeker",
          email: "seeker@example.com",
          password: "password123",
          role: "seeker"
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.msg).toBe("Registered");

      const user = await User.findOne({ email: "seeker@example.com" });
      expect(user).toBeTruthy();
      expect(user.role).toBe("seeker");
    });

    it("should reject duplicate email registration", async () => {
      await createTestUser({ email: "duplicate@example.com" });

      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "Another User",
          email: "duplicate@example.com",
          password: "password123"
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.msg).toBe("User exists");
    });

    it("should reject missing required fields", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          email: "missing@example.com",
          password: "password123"
        });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/auth/login", () => {
    it("should log in with valid credentials and return a token", async () => {
      const user = await createTestUser({ email: "login@example.com", password: "password123" });
      // The helper creates user, but we need to verify hash matches
      const bcrypt = require("bcryptjs");
      user.password = await bcrypt.hash("password123", 10);
      await user.save();

      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: "login@example.com",
          password: "password123"
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it("should reject invalid password", async () => {
      await createTestUser({ email: "wrongpass@example.com" });

      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: "wrongpass@example.com",
          password: "wrongpassword"
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.msg).toBe("Invalid credentials");
    });
  });

  describe("GET /api/users/me", () => {
    it("should return current user profile for authenticated requests", async () => {
      const user = await createTestUser();
      const token = getAuthToken(user);

      const res = await request(app)
        .get("/api/users/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.email).toBe(user.email);
      expect(res.body.password).toBeUndefined(); // Schema JSON removal check
    });

    it("should block requests with no token", async () => {
      const res = await request(app).get("/api/users/me");
      expect(res.statusCode).toBe(401);
    });
  });
});
