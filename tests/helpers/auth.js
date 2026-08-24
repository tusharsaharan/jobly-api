const jwt = require("jsonwebtoken");
const config = require("../../src/config/env");

function createAuthHeader(user) {
  const token = jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    },
    config.jwtSecret,
    { expiresIn: "1h" }
  );
  return {
    token,
    header: `Bearer ${token}`,
  };
}

module.exports = {
  createAuthHeader,
};
