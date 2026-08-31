const jwt = require("jsonwebtoken");
const config = require("../config/env");
const User = require("../models/User");
const logger = require("../config/logger");

function getJwtSecret() {
  const secret = config.JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) return null;
  // In test, allow weak/short secrets to keep integration tests passing; in production enforce 32+ chars
  if (process.env.NODE_ENV === "test") return secret;
  if (secret === "development_secret_key_12345678" || secret.includes("your_jwt") || secret.length < 32) {
    return null;
  }
  return secret;
}

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ msg: "No authentication token provided" });
  }

  try {
    const token = header.split(" ")[1];
    const secret = getJwtSecret();
    if (!secret) return res.status(500).json({ msg: "Server misconfigured: JWT_SECRET not set" });
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });

    // Fast-path: lean projection excluding password
    const user = await User.findById(decoded.id)
      .select("-password")
      .lean();

    if (!user) {
      return res.status(401).json({ msg: "User account no longer exists" });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ msg: "Token expired. Please login again." });
    }
    return res.status(401).json({ msg: "Invalid token" });
  }
};

const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next();
  }

  try {
    const token = header.split(" ")[1];
    const secret = getJwtSecret();
    if (!secret) return next();
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    const user = await User.findById(decoded.id).select("-password").lean();
    if (user) req.user = user;
  } catch {
    // Ignore invalid tokens for optional routes
  }
  next();
};

authMiddleware.optional = optionalAuth;
module.exports = authMiddleware;
