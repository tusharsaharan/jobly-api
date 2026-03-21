const { z } = require("zod");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  JWT_SECRET: z.string().min(8, "JWT_SECRET must be at least 8 characters"),
  JWT_EXPIRES_IN: z.string().default("1h"),
  JWT_REFRESH_SECRET: z.string().default("refresh_token_super_secret_key_jobly_2026"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  GEMINI_API_KEY: z.string().optional(),
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  S3_ENDPOINT: z.string().default("http://127.0.0.1:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("jobly-resumes"),
  S3_ACCESS_KEY_ID: z.string().default("minioadmin"),
  S3_SECRET_ACCESS_KEY: z.string().default("minioadmin"),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  CLIENT_ORIGIN: z.string().default("http://localhost:3000"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default("http://localhost:4318/v1/traces"),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Environment validation error:", result.error.format());
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  }
  return result.data || envSchema.parse({
    MONGO_URI: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/jobmatch",
    JWT_SECRET: process.env.JWT_SECRET || "development_secret_key_12345678",
  });
}

const config = loadEnv();

module.exports = config;
