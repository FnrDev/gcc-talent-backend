const { recordAuditLog } = require("../services/audit.service");
const { SERVICE_IMAGE_TYPES, uploadAttachment } = require("../services/r2.service");
const {
  SERVICE_IMAGE_PURPOSE,
  assertUploadReceiptConfigured,
  createUploadReceipt,
} = require("../services/uploadReceipt.service");

async function createUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Send one file in the multipart field named "attachment".',
    });
  }

  if (req.file.size === 0) {
    return res.status(400).json({ success: false, message: "The attachment cannot be empty." });
  }

  const purpose = req.query?.purpose === undefined ? "attachment" : req.query.purpose;
  if (purpose !== "attachment" && purpose !== SERVICE_IMAGE_PURPOSE) {
    return res.status(400).json({ success: false, message: "Unsupported upload purpose." });
  }
  if (purpose === SERVICE_IMAGE_PURPOSE && !SERVICE_IMAGE_TYPES.has(req.file.mimetype)) {
    return res.status(415).json({
      success: false,
      message: "Service images must be JPEG, PNG, WebP, or GIF files.",
    });
  }

  try {
    if (purpose === SERVICE_IMAGE_PURPOSE) assertUploadReceiptConfigured();

    const attachment = await uploadAttachment({
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      originalName: req.file.originalname,
      purpose,
      userId: req.user._id,
    });
    const receipt = purpose === SERVICE_IMAGE_PURPOSE
      ? createUploadReceipt({ attachment, userId: req.user._id, purpose })
      : undefined;

    await recordAuditLog(req, {
      action: "create",
      resource: "Attachment",
      resourceId: null,
      details: {
        operation: "uploadAttachment",
        purpose,
        key: attachment.key,
        name: attachment.name,
        size: attachment.size,
        contentType: attachment.contentType,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Attachment uploaded successfully.",
      data: {
        attachment: {
          url: attachment.url,
          name: attachment.name,
          size: attachment.size,
          contentType: attachment.contentType,
          ...(receipt ? { receipt } : {}),
        },
      },
    });
  } catch (error) {
    if (error?.code === "INVALID_ATTACHMENT") {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (
      error?.code === "R2_CONFIGURATION_ERROR" ||
      error?.code === "UPLOAD_RECEIPT_CONFIGURATION_ERROR"
    ) {
      console.error("R2 upload configuration is incomplete.");
      return res.status(503).json({
        success: false,
        message: "File uploads are temporarily unavailable.",
      });
    }
    if (error?.code === "R2_UPLOAD_FAILED") {
      console.error("R2 attachment upload failed.");
      return res.status(502).json({
        success: false,
        message: "The attachment could not be uploaded. Please try again.",
      });
    }

    console.error("Unexpected attachment upload failure.");
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

module.exports = { createUpload };
