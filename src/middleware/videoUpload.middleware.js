const multer = require("multer");
const path = require("path");
const fs = require("fs");

const recordingsDir = path.join(__dirname, "../../uploads/recordings");
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, recordingsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webm";
    const sessionId = req.params.sessionId || "session";
    cb(null, `${sessionId}-${Date.now()}${ext}`);
  },
});

const videoUpload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("audio/") ||
      file.mimetype === "application/octet-stream"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only video/audio media files are allowed"));
    }
  },
});

module.exports = videoUpload;
