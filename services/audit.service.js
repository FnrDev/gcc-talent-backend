const crypto = require("node:crypto");
const mongoose = require("mongoose");
const AuditLog = require("../models/AuditLog");

const requestIds = new WeakMap();
const REDACTED = "[REDACTED]";
const MAX_DETAILS_BYTES = 16 * 1024;
const SENSITIVE_KEY = /password|token|secret|authorization|cookie|credential|apikey|privatekey|otp|salt/;

function sanitizeDetails(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 2000);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "object") return undefined;
  if (depth >= 6 || seen.has(value)) return "[TRUNCATED]";
  seen.add(value);

  try {
    if (typeof value.toObject === "function") {
      return sanitizeDetails(value.toObject({ depopulate: true, virtuals: false, getters: false, transform: false }), depth + 1, seen);
    }
    if (Array.isArray(value)) {
      return value.slice(0, 100).map((item) => sanitizeDetails(item, depth + 1, seen));
    }
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) continue;
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      result[key.slice(0, 200)] = SENSITIVE_KEY.test(normalizedKey)
        ? REDACTED
        : sanitizeDetails(item, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function requestMetadata(req) {
  if (!req) return { id: crypto.randomUUID() };
  if (!requestIds.has(req)) requestIds.set(req, crypto.randomUUID());

  // Prefer the matched route template. Never persist query strings, request
  // bodies, cookies, authorization headers, or email/reset links.
  const path = typeof req.route?.path === "string"
    ? `${req.baseUrl || ""}${req.route.path}`
    : String(req.originalUrl || req.url || "").split(/[?#]/, 1)[0];
  return {
    id: requestIds.get(req),
    method: String(req.method || "").slice(0, 16),
    path: path.slice(0, 500),
    ip: String(req.ip || req.socket?.remoteAddress || "").slice(0, 64),
  };
}

function buildEntry(req, entry, request) {
  const identity = Object.hasOwn(entry, "actor") ? entry.actor : (req?.admin || req?.user);
  const actor = identity?._id || identity || null;
  let details = sanitizeDetails(entry.details || {});
  if (Buffer.byteLength(JSON.stringify(details), "utf8") > MAX_DETAILS_BYTES) {
    details = { truncated: true };
  }
  return {
    actor,
    actorType: actor ? "user" : (req ? "anonymous" : "system"),
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId || null,
    affectedCount: entry.affectedCount ?? 1,
    details,
    request,
  };
}

async function recordAuditLogs(req, entries, { session } = {}) {
  // A conditional update that matched/modified nothing is not a mutation.
  const mutations = entries.filter((entry) => (entry.affectedCount ?? 1) > 0);
  if (!mutations.length) return [];

  const request = requestMetadata(req);
  try {
    const documents = mutations.map((entry) => buildEntry(req, entry, request));
    return await AuditLog.insertMany(documents, { ordered: true, ...(session ? { session } : {}) });
  } catch (error) {
    // Do not print the error object: database errors can contain document data.
    console.error("Audit log persistence failed.", { requestId: request.id });
    // In an existing transaction, a failed audit insert must roll back with the
    // business mutation. Outside one, the write has already happened: do not
    // report a false business failure that could cause a duplicate retry.
    if (session?.inTransaction()) throw error;
    return [];
  }
}

async function recordAuditLog(req, { session, ...entry }) {
  const [log] = await recordAuditLogs(req, [entry], { session });
  return log || null;
}

module.exports = { recordAuditLog, recordAuditLogs };
