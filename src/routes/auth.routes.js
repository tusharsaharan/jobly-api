const express = require("express");
const { register, login, refreshToken } = require("../controllers/auth.controller");
const { rateLimitMiddleware, authLimiter } = require("../middleware/rateLimiter.middleware");

const router = express.Router();

router.post("/register", rateLimitMiddleware(authLimiter, (req) => req.ip), register);
router.post("/login", rateLimitMiddleware(authLimiter, (req) => req.ip), login);
router.post("/refresh-token", refreshToken);

module.exports = router;
