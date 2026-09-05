const multer = require("multer");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    // Always validate PDF mimetype; magic bytes are validated in controller for all files regardless of filename (no mock-resume.pdf bypass)
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only PDF allowed"));
    } else {
      cb(null, true);
    }
  },
});

module.exports = upload;
