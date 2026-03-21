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

async function uploadFileBuffer(buffer, key, contentType = "application/pdf") {
  try {
    const command = new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
    await s3Client.send(command);
    return { bucket: config.S3_BUCKET, key };
  } catch (err) {
    logger.error({ err: err.message, key }, "S3 upload failed");
    throw err;
  }
}

async function getFileStream(key) {
  try {
    const command = new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
    });
    const response = await s3Client.send(command);
    return response.Body;
  } catch (err) {
    logger.error({ err: err.message, key }, "S3 get file failed");
    throw err;
  }
}

async function getPresignedDownloadUrl(key, expiresIn = 3600) {
  try {
    const command = new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (err) {
    logger.error({ err: err.message, key }, "Failed generating presigned URL");
    throw err;
  }
}

module.exports = {
  s3Client,
  uploadFileBuffer,
  getFileStream,
  getPresignedDownloadUrl,
};
