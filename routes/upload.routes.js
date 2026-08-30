const router = require("express").Router();
const uploadController = require("../controllers/upload.controller");
const { uploadLimiter } = require("../middleware/rateLimiters");
const uploadAttachment = require("../middleware/uploadAttachment");
const verifyToken = require("../middleware/verifyToken");

router.post("/", verifyToken, uploadLimiter, uploadAttachment, uploadController.createUpload);

module.exports = router;
