// Setup env vars BEFORE any src/config/env import (required for jest)
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "testsecret123";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "testrefreshsecret1234567890";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/test";

// Hermetic tests: neutralize external-service env carried over from the
// developer .env (dotenv runs in setup.js AFTER this file, but require-time
// module state must not see real services). Tests must never call Gemini,
// MinIO/S3, or the terminal runner.
delete process.env.GEMINI_API_KEY;
delete process.env.TERMINAL_RUNNER_URL;
delete process.env.LIVEKIT_API_KEY;
delete process.env.LIVEKIT_API_SECRET;
delete process.env.LIVEKIT_PUBLIC_URL;
process.env.S3_ENDPOINT = "http://127.0.0.1:1"; // unroutable — forces S3 fallback paths

// LiveKit token signing is exercised in unit/integration tests — provide a
// deterministic test keypair (never the real one).
process.env.LIVEKIT_API_KEY = "testkey";
process.env.LIVEKIT_API_SECRET = "test-secret-value-1";
