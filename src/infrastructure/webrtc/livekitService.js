const jwt = require("jsonwebtoken");
const config = require("../../config/env");
const logger = require("../../config/logger");

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "devkey_livekit_jobly";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "secret_livekit_jobly_2026_superkey";

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
