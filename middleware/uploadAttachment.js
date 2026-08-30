const multer = require("multer");
const {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
} = require("../services/r2.service");

const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fields: 0,
    files: 1,
    fileSize: MAX_ATTACHMENT_SIZE_BYTES,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.mimetype)) {
      const error = new Error("Unsupported attachment type.");
      error.code = "UNSUPPORTED_ATTACHMENT_TYPE";
      return callback(error);
    }
    return callback(null, true);
  },
}).single("attachment");

function uploadAttachment(req, res, next) {
  parser(req, res, (error) => {
    if (!error) return next();

    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        message: "Attachment must be 10 MB or smaller.",
      });
    }

    if (error.code === "UNSUPPORTED_ATTACHMENT_TYPE") {
      return res.status(415).json({ success: false, message: error.message });
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        message: 'Send one file in the multipart field named "attachment".',
      });
    }

    return res.status(400).json({ success: false, message: "Invalid attachment upload." });
  });
}

module.exports = uploadAttachment;
