const multer = require("multer");
const { getRecordingKey, getPresignedUploadUrl, RECORDINGS_BUCKET } = require("../config/s3");
const config = require("../config/env");
const logger = require("../config/logger");

const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250MB
const MULTIPART_THRESHOLD = 50 * 1024 * 1024; // 50MB - use multipart for larger files

function createVideoUploadMiddleware() {
  // Use memoryStorage but fileSize limit is enforced by multer; for 250MB we still risk OOM under concurrency
  // Cap to 100MB per file in app unless explicitly overridden, and add magic byte validation in controller
  const memoryStorage = multer.memoryStorage();

  return multer({
    storage: memoryStorage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
      // Strict mimetype check: reject generic octet-stream unless filename extension matches media
      if (file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/")) {
        return cb(null, true);
      }
      if (file.mimetype === "application/octet-stream") {
        const ext = (file.originalname || "").split(".").pop()?.toLowerCase();
        const mediaExts = ["webm", "mp4", "mov", "avi", "mkv", "mp3", "wav", "ogg", "m4a"];
        if (mediaExts.includes(ext)) return cb(null, true);
      }
      cb(new Error("Only video/audio media files are allowed"));
    },
  });
}

const videoUpload = createVideoUploadMiddleware();

async function uploadRecordingToS3(sessionId, file, userId) {
  const ext = file.originalname?.split(".").pop() || "webm";
  const key = `recordings/${sessionId}/${sessionId}-${Date.now()}.${ext}`;

  if (file.size > MULTIPART_THRESHOLD) {
    logger.info({ sessionId, size: file.size }, "Using multipart upload for large recording");
    return await uploadLargeRecording(sessionId, key, file, userId);
  }

  logger.info({ sessionId, size: file.size, key }, "Uploading recording to S3");
  const { uploadFileBuffer } = require("../config/s3");
  await uploadFileBuffer(file.buffer, key, file.mimetype);
  return { key, bucket: RECORDINGS_BUCKET };
}

async function uploadLargeRecording(sessionId, key, file, userId) {
  const { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require("@aws-sdk/client-s3");
  const config = require("../config/env");

  const s3Client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });

  const PART_SIZE = 10 * 1024 * 1024; // 10MB parts
  const buffer = file.buffer;
  const totalParts = Math.ceil(buffer.length / PART_SIZE);

  const createCmd = new CreateMultipartUploadCommand({
    Bucket: RECORDINGS_BUCKET,
    Key: key,
    ContentType: file.mimetype,
  });
  const { UploadId } = await s3Client.send(createCmd);

  const uploadedParts = [];
  try {
    for (let i = 0; i < totalParts; i++) {
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE, buffer.length);
      const partBuffer = buffer.subarray(start, end);

      const uploadCmd = new UploadPartCommand({
        Bucket: RECORDINGS_BUCKET,
        Key: key,
        UploadId,
        PartNumber: i + 1,
        Body: partBuffer,
      });
      const { ETag } = await s3Client.send(uploadCmd);
      uploadedParts.push({ ETag, PartNumber: i + 1 });
    }

    const completeCmd = new CompleteMultipartUploadCommand({
      Bucket: RECORDINGS_BUCKET,
      Key: key,
      UploadId,
      MultipartUpload: { Parts: uploadedParts },
    });
    await s3Client.send(completeCmd);
    logger.info({ sessionId, key, parts: totalParts }, "Multipart upload complete");
    return { key, bucket: RECORDINGS_BUCKET };
  } catch (err) {
    await s3Client.send(new AbortMultipartUploadCommand({
      Bucket: RECORDINGS_BUCKET,
      Key: key,
      UploadId,
    }));
    throw err;
  }
}

async function getPresignedRecordingUploadUrl(sessionId, ext = "webm", expiresIn = 3600) {
  const { getPresignedUploadUrl } = require("../config/s3");
  const key = `recordings/${sessionId}/${sessionId}-${Date.now()}.${ext}`;
  return await getPresignedUploadUrl(key, expiresIn, "video/webm");
}

module.exports = {
  videoUpload,
  uploadRecordingToS3,
  getPresignedRecordingUploadUrl,
};