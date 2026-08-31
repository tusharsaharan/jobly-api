const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const config = require("./env");
const logger = require("./logger");

const s3Client = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
});

// Normalize S3 key: strip leading slashes, collapse duplicate slashes, avoid double slash when concatenating
function normalizeKey(key) {
  if (!key) return key;
  return String(key).replace(/^\/+/, "").replace(/\/\/+/g, "/");
}

// Extract S3 key from various recordingUrl forms (s3://bucket/key, /uploads/..., bare key)
// Returns { normalizedKey, isS3 } — isS3 true only for s3:// URLs
function parseRecordingUrl(recordingUrl) {
  if (!recordingUrl) return { normalizedKey: null, isS3: false, isLocal: false };
  const raw = String(recordingUrl).trim();
  if (raw.startsWith("s3://")) {
    const withoutProtocol = raw.replace(/^s3:\/\//, "");
    const slashIdx = withoutProtocol.indexOf("/");
    const key = slashIdx >= 0 ? withoutProtocol.slice(slashIdx + 1) : "";
    return { normalizedKey: normalizeKey(key), isS3: true, isLocal: false, bucket: withoutProtocol.slice(0, slashIdx >=0 ? slashIdx : withoutProtocol.length) };
  }
  if (raw.startsWith("/uploads/")) {
    return { normalizedKey: null, isS3: false, isLocal: true, localPath: "/" + normalizeKey(raw) };
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return { normalizedKey: null, isS3: false, isLocal: false, httpUrl: raw };
  }
  // bare key
  return { normalizedKey: normalizeKey(raw), isS3: false, isLocal: false };
}

async function uploadFileBuffer(buffer, key, contentType = "application/pdf") {
  const normalizedKey = normalizeKey(key);
  try {
    const command = new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: normalizedKey,
      Body: buffer,
      ContentType: contentType,
    });
    await s3Client.send(command);
    return { bucket: config.S3_BUCKET, key: normalizedKey };
  } catch (err) {
    logger.error({ err: err.message, key: normalizedKey }, "S3 upload failed");
    throw err;
  }
}

async function getFileStream(key) {
  const normalizedKey = normalizeKey(key);
  try {
    const command = new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: normalizedKey,
    });
    const response = await s3Client.send(command);
    return response.Body;
  } catch (err) {
    logger.error({ err: err.message, key: normalizedKey }, "S3 get file failed");
    throw err;
  }
}

async function getPresignedDownloadUrl(key, expiresIn = 3600) {
  const normalizedKey = normalizeKey(key);
  try {
    const command = new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: normalizedKey,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (err) {
    logger.error({ err: err.message, key: normalizedKey }, "Failed generating presigned URL");
    throw err;
  }
}

async function getPresignedUploadUrl(key, expiresIn = 3600, contentType = "video/webm") {
  const normalizedKey = normalizeKey(key);
  try {
    const command = new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: normalizedKey,
      ContentType: contentType,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (err) {
    logger.error({ err: err.message, key: normalizedKey }, "Failed generating presigned upload URL");
    throw err;
  }
}

async function getPresignedM3U8Url(key, expiresIn = 3600) {
  const normalizedKey = normalizeKey(key);
  try {
    const command = new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: normalizedKey,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (err) {
    logger.error({ err: err.message, key: normalizedKey }, "Failed generating presigned M3U8 URL");
    throw err;
  }
}

async function uploadFileStream(key, stream, contentType = "video/webm") {
  const normalizedKey = normalizeKey(key);
  try {
    const command = new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: normalizedKey,
      Body: stream,
      ContentType: contentType,
    });
    await s3Client.send(command);
    return { bucket: config.S3_BUCKET, key: normalizedKey };
  } catch (err) {
    logger.error({ err: err.message, key: normalizedKey }, "S3 stream upload failed");
    throw err;
  }
}

const RECORDINGS_BUCKET = process.env.S3_RECORDINGS_BUCKET || config.S3_BUCKET;
const RECORDINGS_PREFIX = "recordings/";

function getRecordingKey(sessionId, ext = "webm") {
  const cleanPrefix = RECORDINGS_PREFIX.replace(/\/+$/, "") + "/";
  const cleanExt = String(ext).replace(/^\.+/, "").replace(/[^a-zA-Z0-9]/g, "") || "webm";
  return normalizeKey(`${cleanPrefix}${sessionId}-${Date.now()}.${cleanExt}`);
}

function getHLSKey(sessionId) {
  const cleanPrefix = RECORDINGS_PREFIX.replace(/\/+$/, "") + "/";
  return normalizeKey(`${cleanPrefix}${sessionId}/index.m3u8`);
}

module.exports = {
  s3Client,
  uploadFileBuffer,
  getFileStream,
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
  getPresignedM3U8Url,
  uploadFileStream,
  RECORDINGS_BUCKET,
  RECORDINGS_PREFIX,
  getRecordingKey,
  getHLSKey,
  normalizeKey,
  parseRecordingUrl,
};
