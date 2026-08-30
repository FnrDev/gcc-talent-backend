const { createHmac, timingSafeEqual } = require("node:crypto");

const RECEIPT_VERSION = 1;
const SERVICE_IMAGE_PURPOSE = "service-image";

function configurationError() {
  const error = new Error("Upload receipt signing is not configured.");
  error.code = "UPLOAD_RECEIPT_CONFIGURATION_ERROR";
  return error;
}

function getSigningSecret() {
  const secret = String(process.env.UPLOAD_RECEIPT_SECRET || process.env.JWT_SECRET || "").trim();
  if (!secret) throw configurationError();
  return secret;
}

function assertUploadReceiptConfigured() {
  getSigningSecret();
}

function attachmentPayload({ attachment, userId, purpose }) {
  return {
    version: RECEIPT_VERSION,
    userId: String(userId),
    purpose,
    url: attachment.url,
    name: attachment.name,
    size: attachment.size,
    contentType: attachment.contentType,
  };
}

function sign(encodedPayload) {
  return createHmac("sha256", getSigningSecret())
    .update("gcc-talent:upload-receipt:v1:")
    .update(encodedPayload)
    .digest("base64url");
}

function createUploadReceipt({ attachment, userId, purpose = SERVICE_IMAGE_PURPOSE }) {
  const encodedPayload = Buffer.from(
    JSON.stringify(attachmentPayload({ attachment, userId, purpose })),
    "utf8",
  ).toString("base64url");

  return `${encodedPayload}.${sign(encodedPayload)}`;
}

function verifyUploadReceipt(receipt, { attachment, userId, purpose = SERVICE_IMAGE_PURPOSE }) {
  if (typeof receipt !== "string" || receipt.length > 4096) return false;

  const parts = receipt.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;

  const [encodedPayload, encodedSignature] = parts;
  const expectedSignature = Buffer.from(sign(encodedPayload), "utf8");
  const receivedSignature = Buffer.from(encodedSignature, "utf8");

  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const expected = attachmentPayload({ attachment, userId, purpose });

    return (
      payload?.version === expected.version &&
      payload.userId === expected.userId &&
      payload.purpose === expected.purpose &&
      payload.url === expected.url &&
      payload.name === expected.name &&
      payload.size === expected.size &&
      payload.contentType === expected.contentType
    );
  } catch (_) {
    return false;
  }
}

module.exports = {
  SERVICE_IMAGE_PURPOSE,
  assertUploadReceiptConfigured,
  createUploadReceipt,
  verifyUploadReceipt,
};
