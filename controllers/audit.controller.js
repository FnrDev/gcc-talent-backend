const { AuditLog, User } = require("../models");

const ALLOWED_QUERY_FIELDS = new Set([
  "page", "limit", "action", "resource", "actor", "resourceId", "search", "from", "to",
]);
const AUDIT_ACTIONS = AuditLog.schema.path("action").enumValues;
const AUDIT_RESOURCES = AuditLog.schema.path("resource").enumValues;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;

class QueryValidationError extends Error {}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function positiveInteger(value, defaultValue, name) {
  if (value === undefined) return defaultValue;

  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new QueryValidationError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function timestamp(value, name) {
  // Require an explicit timezone and reject calendar dates that Date.parse
  // would silently normalize (for example, February 30).
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) {
    throw new QueryValidationError(`${name} must be a valid ISO timestamp with a timezone.`);
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = parts;
  const [year, month, day, hour, minute, second] =
    [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const parsed = new Date(value);

  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
    hour > 23 || minute > 59 || second > 59 || Number.isNaN(parsed.getTime())
  ) {
    throw new QueryValidationError(`${name} must be a valid ISO timestamp with a timezone.`);
  }
  return parsed;
}

function parseQuery(query) {
  for (const [name, value] of Object.entries(query)) {
    if (!ALLOWED_QUERY_FIELDS.has(name)) {
      throw new QueryValidationError(`Unsupported audit log filter: ${name}.`);
    }
    if (typeof value !== "string") {
      throw new QueryValidationError(`${name} must be a single string value.`);
    }
  }

  const page = positiveInteger(query.page, 1, "page");
  const limit = Math.min(positiveInteger(query.limit, 20, "limit"), MAX_PAGE_SIZE);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) {
    throw new QueryValidationError("page is too large.");
  }

  const filter = {};
  for (const [name, allowedValues] of [["action", AUDIT_ACTIONS], ["resource", AUDIT_RESOURCES]]) {
    if (query[name] !== undefined) {
      if (!allowedValues.includes(query[name])) {
        throw new QueryValidationError(`Invalid ${name} filter.`);
      }
      filter[name] = query[name];
    }
  }

  for (const name of ["actor", "resourceId"]) {
    if (query[name] !== undefined) {
      if (!OBJECT_ID_PATTERN.test(query[name])) {
        throw new QueryValidationError(`${name} must be a valid ObjectId.`);
      }
      filter[name] = query[name];
    }
  }

  if (query.search !== undefined) {
    if (query.search.length > MAX_SEARCH_LENGTH) {
      throw new QueryValidationError(`search must be at most ${MAX_SEARCH_LENGTH} characters.`);
    }
    const search = query.search.trim();
    if (search) {
      const pattern = new RegExp(escapeRegExp(search), "i");
      filter.$or = [
        { "details.operation": pattern },
        { "request.path": pattern },
        { "request.id": search },
      ];
      if (OBJECT_ID_PATTERN.test(search)) {
        filter.$or.push({ _id: search }, { actor: search }, { resourceId: search });
      }
    }
  }

  const from = query.from === undefined ? undefined : timestamp(query.from, "from");
  const to = query.to === undefined ? undefined : timestamp(query.to, "to");
  if (from && to && from > to) {
    throw new QueryValidationError("from must be earlier than or equal to to.");
  }
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  return { filter, page, limit, skip };
}

async function getAuditLogs(req, res) {
  res.set("Cache-Control", "no-store");

  try {
    const { filter, page, limit, skip } = parseQuery(req.query);
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .select("actor actorType action resource resourceId affectedCount details request createdAt")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    // Avoid populate(): it replaces deleted users' IDs with null. Keep their
    // historical ID and fetch only safe summaries for this bounded page.
    const actorIds = [...new Set(logs.filter((log) => log.actor).map((log) => String(log.actor)))];
    const actors = actorIds.length
      ? await User.find({ _id: { $in: actorIds } }).select("_id name email").lean()
      : [];
    const actorsById = new Map(actors.map((actor) => [String(actor._id), {
      _id: actor._id,
      name: actor.name,
      email: actor.email,
    }]));

    return res.status(200).json({
      logs: logs.map((log) => ({
        ...log,
        actor: log.actor || null,
        actorUser: log.actor ? actorsById.get(String(log.actor)) || null : null,
      })),
      pagination: { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
    });
  } catch (err) {
    if (err instanceof QueryValidationError) {
      return res.status(400).json({ message: err.message });
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
}

module.exports = { getAuditLogs };
