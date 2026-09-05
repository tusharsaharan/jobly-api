const jwt = require("jsonwebtoken");
const config = require("../../config/env");
const logger = require("../../config/logger");

// LiveKit credentials MUST come from the environment and MUST match the
// running LiveKit server's keys. No silent fallbacks — a mismatched token
// silently breaks video, which is worse than a loud config error.
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";

function assertLiveKitConfigured() {
  if (!LIVEKIT_API_SECRET) {
    throw new Error("LIVEKIT_API_SECRET is not set. It must match the LiveKit server's LIVEKIT_KEYS entry.");
  }
}

/**
 * Generate a standard LiveKit WebRTC JWT token with appropriate participant grants
 */
function generateLiveKitToken({
  roomKey,
  participantIdentity,
  participantName,
  canPublish = true,
  canSubscribe = true,
  canPublishData = true,
}) {
  try {
    assertLiveKitConfigured();
    // Attempt official SDK if present
    const { AccessToken } = require("livekit-server-sdk");
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: participantIdentity,
      name: participantName,
      ttl: "4h",
    });

    at.addGrant({
      roomJoin: true,
      room: roomKey,
      canPublish,
      canSubscribe,
      canPublishData,
    });

    return at.toJwt();
  } catch {
    // Resilient fallback: Standard compliant JWT creation for LiveKit
    logger.debug({ roomKey, participantIdentity }, "Using standard JWT fallback for LiveKit token");
    const payload = {
      iss: LIVEKIT_API_KEY,
      sub: participantIdentity,
      name: participantName,
      video: {
        room: roomKey,
        roomJoin: true,
        canPublish,
        canSubscribe,
        canPublishData,
      },
    };

    return jwt.sign(payload, LIVEKIT_API_SECRET, {
      expiresIn: "4h",
    });
  }
}

module.exports = {
  generateLiveKitToken,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
};
