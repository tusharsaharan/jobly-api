// Setup env vars BEFORE any src/config/env import (required for jest)
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "testsecret123";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "testrefreshsecret1234567890";
process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/test";
