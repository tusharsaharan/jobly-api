const crypto = require("crypto");

function requestIdMiddleware(req, res, next) {
  const incomingId = req.header("x-request-id");
  const requestId = incomingId || crypto.randomUUID();
  req.id = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}

module.exports = requestIdMiddleware;
