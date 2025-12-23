const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config/env");
const logger = require("../config/logger");

function generateTokens(userId, role) {
  const token = jwt.sign(
    { id: userId, role },
    config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678",
    { expiresIn: config.JWT_EXPIRES_IN || "1h" }
  );

  const refreshToken = jwt.sign(
    { id: userId },
    config.JWT_REFRESH_SECRET || "refresh_token_super_secret_key_jobly_2026",
    { expiresIn: config.JWT_REFRESH_EXPIRES_IN || "7d" }
  );

  return { token, refreshToken };
}

exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ msg: "Please provide name, email, and password" });
    }

    if (role && !["seeker", "recruiter"].includes(role)) {
      return res.status(400).json({ msg: "Role must be 'seeker' or 'recruiter'" });
    }

    const emailLower = email.toLowerCase().trim();
    const exists = await User.findOne({ email: emailLower });
    if (exists) return res.status(400).json({ msg: "User exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: emailLower,
      password: hashed,
      role: role || "seeker",
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
    if (!email || !password) {
      return res.status(400).json({ msg: "Please provide email and password" });
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
    if (!refreshToken) {
      return res.status(400).json({ msg: "Refresh token required" });
    }

    const decoded = jwt.verify(
      refreshToken,
      config.JWT_REFRESH_SECRET || "refresh_token_super_secret_key_jobly_2026"
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
