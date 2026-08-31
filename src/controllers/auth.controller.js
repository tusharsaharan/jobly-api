const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config/env");
const logger = require("../config/logger");

function generateTokens(userId, role) {
  const token = jwt.sign(
    { id: userId, role },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );

  const refreshToken = jwt.sign(
    { id: userId },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_EXPIRES_IN }
  );

  return { token, refreshToken };
}

exports.register = async (req, res) => {
  try {
    const { name, email, password, role, tenantId } = req.body;

    if (!name || typeof name !== "string" || !email || typeof email !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ msg: "Please provide valid name, email, and password" });
    }
    // Enforce minimal password strength
    if (password.length < 8) {
      return res.status(400).json({ msg: "Password must be at least 8 characters" });
    }

    if (role && !["seeker", "recruiter"].includes(role)) {
      return res.status(400).json({ msg: "Role must be 'seeker' or 'recruiter'" });
    }

    const emailLower = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      return res.status(400).json({ msg: "Invalid email format" });
    }
    const exists = await User.findOne({ email: emailLower });
    if (exists) return res.status(400).json({ msg: "User exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: emailLower,
      password: hashed,
      role: role || "seeker",
      tenantId: tenantId || "default",
    });

    const { token, refreshToken } = generateTokens(user._id, user.role);

    res.status(200).json({
      msg: "Registered",
      token,
      refreshToken,
      user,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Register error");
    res.status(500).json({ msg: "Registration failed" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ msg: "Please provide valid email and password" });
    }

    const emailLower = email.toLowerCase().trim();
    const user = await User.findOne({ email: emailLower });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ msg: "Invalid credentials" });

    const { token, refreshToken } = generateTokens(user._id, user.role);

    res.json({
      token,
      refreshToken,
      user,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Login error");
    res.status(500).json({ msg: "Login failed" });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken || typeof refreshToken !== "string") {
      return res.status(400).json({ msg: "Valid refresh token required" });
    }

    const decoded = jwt.verify(
      refreshToken,
      config.JWT_REFRESH_SECRET
    );

    const user = await User.findById(decoded.id).select("-password -resumeText").lean();
    if (!user) {
      return res.status(401).json({ msg: "User not found" });
    }

    const tokens = generateTokens(user._id, user.role);
    res.json(tokens);
  } catch (err) {
    return res.status(401).json({ msg: "Invalid or expired refresh token" });
  }
};

exports.updateSkills = async (req, res) => {
  try {
    const { skills } = req.body;
    if (!Array.isArray(skills)) {
      return res.status(400).json({ msg: "skills must be an array" });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { skills },
      { new: true }
    );
    res.json(user);
  } catch (err) {
    logger.error({ err: err.message }, "Update skills error");
    res.status(500).json({ msg: "Failed to update skills" });
  }
};
