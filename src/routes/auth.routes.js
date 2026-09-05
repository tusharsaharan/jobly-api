const express = require("express");
const { register, login, refreshToken } = require("../controllers/auth.controller");
const { rateLimitMiddleware, authLimiter } = require("../middleware/rateLimiter.middleware");

const router = express.Router();

router.post("/register", rateLimitMiddleware(authLimiter, (req) => req.ip), register);
router.post("/login", rateLimitMiddleware(authLimiter, (req) => req.ip), login);
router.post("/refresh-token", rateLimitMiddleware(authLimiter, (req) => req.ip), refreshToken);

module.exports = router;
