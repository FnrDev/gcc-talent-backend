const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const R2_BUCKET_NAME = "gcc-talent";
const R2_UPLOAD_TIMEOUT_MS = 15_000;
const R2_JURISDICTIONS = new Set(["default", "eu", "us", "fedramp"]);
const SERVICE_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const MIME_EXTENSIONS = new Map([
  ["application/msword", ".doc"],
  ["application/pdf", ".pdf"],
  ["application/vnd.ms-excel", ".xls"],
  ["application/vnd.ms-powerpoint", ".ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/x-zip-compressed", ".zip"],
  ["application/zip", ".zip"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["text/csv", ".csv"],
  ["text/plain", ".txt"],
]);

let cachedConfiguration;
let cachedClient;

function r2Error(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parsePublicBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw r2Error("R2_CONFIGURATION_ERROR", "R2_PUBLIC_BASE_URL must be a valid HTTPS URL.");
  }

  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw r2Error(
      "R2_CONFIGURATION_ERROR",
      "R2_PUBLIC_BASE_URL must be an HTTPS origin without credentials, a path, a query, or a fragment."
    );
  }

  return url.toString().replace(/\/$/, "");
}

function getConfiguration() {
  if (cachedConfiguration) return cachedConfiguration;

  const accountId = (process.env.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || "").trim();
  const jurisdiction = (process.env.R2_JURISDICTION || "default").trim().toLowerCase();

  if (!/^[a-f\d]{32}$/i.test(accountId)) {
    throw r2Error("R2_CONFIGURATION_ERROR", "A valid R2_ACCOUNT_ID is required.");
  }
  if (!accessKeyId || !secretAccessKey) {
    throw r2Error("R2_CONFIGURATION_ERROR", "R2 access credentials are required.");
  }
  if (!publicBaseUrl) {
    throw r2Error("R2_CONFIGURATION_ERROR", "R2_PUBLIC_BASE_URL is required.");
  }
  if (!R2_JURISDICTIONS.has(jurisdiction)) {
    throw r2Error(
      "R2_CONFIGURATION_ERROR",
      "R2_JURISDICTION must be default, eu, us, or fedramp."
    );
  }

  cachedConfiguration = {
    accountId,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: parsePublicBaseUrl(publicBaseUrl),
    jurisdiction,
  };
  return cachedConfiguration;
}

function getClient(configuration) {
  if (!cachedClient) {
    const endpointPrefix = configuration.jurisdiction === "default"
      ? configuration.accountId
      : `${configuration.accountId}.${configuration.jurisdiction}`;
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${endpointPrefix}.r2.cloudflarestorage.com`,
      // Recent AWS SDK releases add a CRC32 full-object checksum by default.
      // R2 does not support that checksum shape, so only calculate/validate a
      // checksum when an operation explicitly requires one.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
    });
  }
  return cachedClient;
}

function sanitizeAttachmentName(originalName, contentType) {
  const baseName = path.basename(String(originalName || "").replaceAll("\\", "/"));
  const normalized = baseName
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const name = normalized || "attachment";
  const extension = MIME_EXTENSIONS.get(contentType);

  if (!extension) return Array.from(name).slice(0, 180).join("");

  const currentExtension = path.extname(name);
  const stem = (currentExtension ? name.slice(0, -currentExtension.length) : name)
    .replace(/^[.\s]+|[.\s]+$/g, "") || "attachment";
  const maxStemLength = 180 - Array.from(extension).length;
  return `${Array.from(stem).slice(0, maxStemLength).join("")}${extension}`;
}

function contentDisposition(name, disposition = "attachment") {
  const asciiName = name
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encodedName = encodeURIComponent(name).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

function buildPublicUrl(publicBaseUrl, key) {
  const base = new URL(`${publicBaseUrl.replace(/\/+$/, "")}/`);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return new URL(encodedKey, base).toString();
}

function hasValidServiceImageSignature(buffer, contentType) {
  if (!Buffer.isBuffer(buffer)) return false;

  if (contentType === "image/png") {
    const pngEnd = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    return (
      buffer.length >= 45 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
      buffer.readUInt32BE(8) === 13 &&
      buffer.toString("ascii", 12, 16) === "IHDR" &&
      buffer.readUInt32BE(16) > 0 &&
      buffer.readUInt32BE(20) > 0 &&
      buffer.subarray(-12).equals(pngEnd)
    );
  }

  if (contentType === "image/jpeg") {
    if (
      buffer.length < 12 ||
      buffer[0] !== 0xff ||
      buffer[1] !== 0xd8 ||
      buffer[buffer.length - 2] !== 0xff ||
      buffer[buffer.length - 1] !== 0xd9
    ) return false;

    const startOfFrameMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    let offset = 2;

    while (offset + 3 < buffer.length) {
      if (buffer[offset] !== 0xff) return false;
      while (buffer[offset] === 0xff) offset += 1;

      const marker = buffer[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) return false;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > buffer.length) return false;

      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) return false;
      if (startOfFrameMarkers.has(marker)) {
        return (
          segmentLength >= 8 &&
          buffer.readUInt16BE(offset + 3) > 0 &&
          buffer.readUInt16BE(offset + 5) > 0
        );
      }
      offset += segmentLength;
    }

    return false;
  }

  if (contentType === "image/gif") {
    const header = buffer.toString("ascii", 0, 6);
    return (
      buffer.length >= 14 &&
      (header === "GIF87a" || header === "GIF89a") &&
      buffer.readUInt16LE(6) > 0 &&
      buffer.readUInt16LE(8) > 0 &&
      buffer.indexOf(0x2c, 13) !== -1 &&
      buffer[buffer.length - 1] === 0x3b
    );
  }

  if (contentType === "image/webp") {
    return (
      buffer.length >= 20 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.readUInt32LE(4) + 8 === buffer.length &&
      buffer.toString("ascii", 8, 12) === "WEBP" &&
      ["VP8 ", "VP8L", "VP8X"].includes(buffer.toString("ascii", 12, 16)) &&
      buffer.readUInt32LE(16) > 0 &&
      buffer.readUInt32LE(16) + 20 <= buffer.length
    );
  }

  return false;
}

async function uploadAttachment({ buffer, contentType, originalName, purpose = "attachment", userId }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw r2Error("INVALID_ATTACHMENT", "The attachment cannot be empty.");
  }
  if (!MIME_EXTENSIONS.has(contentType)) {
    throw r2Error("INVALID_ATTACHMENT", "Unsupported attachment type.");
  }
  if (!userId) {
    throw r2Error("INVALID_ATTACHMENT", "An authenticated user is required.");
  }
  if (purpose === "service-image" && !SERVICE_IMAGE_TYPES.has(contentType)) {
    throw r2Error("INVALID_ATTACHMENT", "Service images must be JPEG, PNG, WebP, or GIF files.");
  }
  if (purpose === "service-image" && !hasValidServiceImageSignature(buffer, contentType)) {
    throw r2Error("INVALID_ATTACHMENT", "The file contents do not match the selected image type.");
  }

  const configuration = getConfiguration();
  const name = sanitizeAttachmentName(originalName, contentType);
  const datePrefix = new Date().toISOString().slice(0, 10);
  const key = `attachments/${String(userId)}/${datePrefix}/${randomUUID()}${MIME_EXTENSIONS.get(contentType)}`;
  const isServiceImage = purpose === "service-image";

  try {
    await getClient(configuration).send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentLength: buffer.length,
        ContentType: contentType,
        ContentDisposition: contentDisposition(name, isServiceImage ? "inline" : "attachment"),
        CacheControl: isServiceImage
          ? "public, max-age=31536000, immutable"
          : "private, no-store",
      }),
      { abortSignal: AbortSignal.timeout(R2_UPLOAD_TIMEOUT_MS) }
    );
  } catch {
    throw r2Error("R2_UPLOAD_FAILED", "The attachment could not be uploaded.");
  }

  return {
    key,
    url: buildPublicUrl(configuration.publicBaseUrl, key),
    name,
    size: buffer.length,
    contentType,
  };
}

module.exports = {
  ALLOWED_ATTACHMENT_TYPES: new Set(MIME_EXTENSIONS.keys()),
  MAX_ATTACHMENT_SIZE_BYTES: 10 * 1024 * 1024,
  R2_BUCKET_NAME,
  SERVICE_IMAGE_TYPES,
  hasValidServiceImageSignature,
  sanitizeAttachmentName,
  uploadAttachment,
};
