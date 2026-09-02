const {
  User,
  Job,
  Proposal,
  Contract,
  Category,
  Skill,
  Package,
  Service,
} = require("../models");
const { recordAuditLog } = require("../services/audit.service");

const JOB_STATUSES = ["draft", "open", "in_progress", "completed", "closed"];
const JOB_BUDGET_TYPES = ["fixed", "hourly"];
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;

const JOB_SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  title_asc: { title: 1, _id: 1 },
  title_desc: { title: -1, _id: -1 },
  status_asc: { status: 1, createdAt: -1, _id: -1 },
  status_desc: { status: -1, createdAt: -1, _id: -1 },
  proposals_high: { proposalsCount: -1, createdAt: -1, _id: -1 },
  proposals_low: { proposalsCount: 1, createdAt: -1, _id: -1 },
  "-createdAt": { createdAt: -1, _id: -1 },
  createdAt: { createdAt: 1, _id: 1 },
  title: { title: 1, _id: 1 },
  "-title": { title: -1, _id: -1 },
  status: { status: 1, createdAt: -1, _id: -1 },
  "-status": { status: -1, createdAt: -1, _id: -1 },
  proposalsCount: { proposalsCount: 1, createdAt: -1, _id: -1 },
  "-proposalsCount": { proposalsCount: -1, createdAt: -1, _id: -1 },
};

const SERVICE_SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  name_asc: { name: 1, _id: 1 },
  name_desc: { name: -1, _id: -1 },
  "-createdAt": { createdAt: -1, _id: -1 },
  createdAt: { createdAt: 1, _id: 1 },
  name: { name: 1, _id: 1 },
  "-name": { name: -1, _id: -1 },
};

class QueryValidationError extends Error {}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePositiveInteger(value, fallback, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new QueryValidationError(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new QueryValidationError(`${name} must be at most ${maximum}.`);
  }

  return parsed;
}

function parseListQuery(query, sorts) {
  const page = parsePositiveInteger(query.page, 1, "page");
  const limit = parsePositiveInteger(query.limit, 20, "limit", MAX_PAGE_SIZE);
  const sort = query.sort === undefined ? "newest" : query.sort;

  if (typeof sort !== "string" || !sorts[sort]) {
    throw new QueryValidationError("Invalid sort option.");
  }

  if (query.search !== undefined && typeof query.search !== "string") {
    throw new QueryValidationError("search must be a single string value.");
  }

  const search = String(query.search || "").trim();
  if (search.length > MAX_SEARCH_LENGTH) {
    throw new QueryValidationError(`search must be at most ${MAX_SEARCH_LENGTH} characters.`);
  }

  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) {
    throw new QueryValidationError("page is too large.");
  }

  return { page, limit, skip, sort: sorts[sort], search };
}

function applyVisibilityFilter(filter, value) {
  if (value === undefined || value === "" || value === "all") return;
  if (value === "hidden" || value === "true") {
    filter.isHidden = true;
    return;
  }
  if (value === "visible" || value === "false") {
    // Older Service documents predate isHidden and are visible by default.
    filter.isHidden = { $ne: true };
    return;
  }
  throw new QueryValidationError("visibility must be all, visible, or hidden.");
}

function applyFeaturedFilter(filter, value) {
  if (value === undefined || value === "" || value === "all") return;
  if (value === "featured" || value === "true") {
    filter.isFeatured = true;
    return;
  }
  if (["standard", "unfeatured", "not_featured", "false"].includes(value)) {
    filter.isFeatured = { $ne: true };
    return;
  }
  throw new QueryValidationError("featured must be all, featured, or standard.");
}

function paginationResult(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

function handleError(res, error) {
  if (error instanceof QueryValidationError) {
    return res.status(400).json({ message: error.message });
  }

  if (error?.code === 11000) {
    if (error.keyPattern?.freelancer && error.keyPattern?.name) {
      return res.status(409).json({
        message: "This freelancer already has a service with that name.",
      });
    }
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || "value";
    return res.status(409).json({ message: `A record with that ${field} already exists.` });
  }

  if (error?.name === "ValidationError") {
    return res.status(400).json({ message: error.message });
  }

  if (error?.name === "CastError") {
    return res.status(404).json({ message: "Resource not found." });
  }

  console.error(error);
  return res.status(500).json({ message: "Internal Server Error" });
}

function populateJob(query) {
  return query
    .populate("client", "name email role status avatarUrl")
    .populate("category", "name slug")
    .populate("skills", "name category");
}

function populateService(query) {
  return query
    .populate("freelancer", "name email role status avatarUrl")
    .populate(
      "packages",
      "name title description price currency deliveryDays revisions features isActive sortOrder createdAt updatedAt",
    );
}

async function getJobs(req, res) {
  try {
    const { page, limit, skip, sort, search } = parseListQuery(req.query, JOB_SORTS);
    const filter = {};

    if (req.query.status !== undefined && req.query.status !== "" && req.query.status !== "all") {
      if (typeof req.query.status !== "string" || !JOB_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ message: "Invalid job status filter." });
      }
      filter.status = req.query.status;
    }

    applyVisibilityFilter(filter, req.query.visibility);
    applyFeaturedFilter(filter, req.query.featured);

    if (search) {
      const pattern = new RegExp(escapeRegExp(search), "i");
      const [clientIds, categoryIds, skillIds] = await Promise.all([
        User.find({ $or: [{ name: pattern }, { email: pattern }] }).distinct("_id"),
        Category.find({ $or: [{ name: pattern }, { slug: pattern }] }).distinct("_id"),
        Skill.find({ name: pattern }).distinct("_id"),
      ]);
      filter.$or = [
        { title: pattern },
        { description: pattern },
        { client: { $in: clientIds } },
        { category: { $in: categoryIds } },
        { skills: { $in: skillIds } },
      ];
    }

    const [jobs, total] = await Promise.all([
      populateJob(
        Job.find(filter)
          .select(
            "client category skills title description budgetType budgetMin budgetMax experienceLevel duration attachments status deadline proposalsCount isFeatured isHidden createdAt updatedAt",
          )
          .sort(sort)
          .skip(skip)
          .limit(limit),
      ).lean(),
      Job.countDocuments(filter),
    ]);

    return res.status(200).json({ jobs, pagination: paginationResult(page, limit, total) });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getJob(req, res) {
  try {
    const [job, proposals, contracts] = await Promise.all([
      populateJob(
        Job.findById(req.params.id).select(
          "client category skills title description budgetType budgetMin budgetMax experienceLevel duration attachments status deadline proposalsCount isFeatured isHidden createdAt updatedAt",
        ),
      ).lean(),
      Proposal.countDocuments({ job: req.params.id }),
      Contract.countDocuments({ "source.type": "job", "source.job": req.params.id }),
    ]);

    if (!job) return res.status(404).json({ message: "Job not found." });
    return res.status(200).json({ job, references: { proposals, contracts } });
  } catch (error) {
    return handleError(res, error);
  }
}

function validateJobCanOpen(job) {
  if (!job.title || !job.description || !job.category || !job.budgetType) {
    return "Job is missing required information and cannot be opened.";
  }
  if (!JOB_BUDGET_TYPES.includes(job.budgetType)) {
    return "Job has an invalid budget type and cannot be opened.";
  }
  if (job.budgetMin !== undefined && (!Number.isFinite(job.budgetMin) || job.budgetMin < 0)) {
    return "Job has an invalid minimum budget and cannot be opened.";
  }
  if (job.budgetMax !== undefined && (!Number.isFinite(job.budgetMax) || job.budgetMax < 0)) {
    return "Job has an invalid maximum budget and cannot be opened.";
  }
  if (
    job.budgetMin !== undefined &&
    job.budgetMax !== undefined &&
    job.budgetMin > job.budgetMax
  ) {
    return "Job minimum budget cannot be greater than its maximum budget.";
  }
  if (job.deadline && job.deadline <= new Date()) {
    return "Update the deadline before opening this job.";
  }
  return null;
}

async function validateJobStatusChange(job, nextStatus) {
  const allowedTransitions = {
    draft: ["open"],
    open: ["closed"],
    closed: ["open"],
    in_progress: [],
    completed: [],
  };

  if (!allowedTransitions[job.status]?.includes(nextStatus)) {
    return "This status change is not allowed. In-progress and completed jobs are managed by the contract lifecycle.";
  }

  if (nextStatus === "open") {
    const validationError = validateJobCanOpen(job);
    if (validationError) return validationError;

    const [clientExists, categoryExists] = await Promise.all([
      User.exists({ _id: job.client, role: "client", status: "active" }),
      Category.exists({ _id: job.category }),
    ]);
    if (!clientExists) return "Only a job belonging to an active client can be opened.";
    if (!categoryExists) return "Job category no longer exists.";
  }

  return null;
}

async function updateJob(req, res) {
  try {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};
    const requestedFields = ["status", "isHidden", "isFeatured"].filter((field) =>
      Object.hasOwn(body, field),
    );

    if (requestedFields.length === 0) {
      return res.status(400).json({
        message: "Provide status, isHidden, or isFeatured to update.",
      });
    }

    if (Object.hasOwn(body, "status") && !JOB_STATUSES.includes(body.status)) {
      return res.status(400).json({ message: "Invalid job status." });
    }
    for (const field of ["isHidden", "isFeatured"]) {
      if (Object.hasOwn(body, field) && typeof body[field] !== "boolean") {
        return res.status(400).json({ message: `${field} must be a boolean.` });
      }
    }

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found." });

    if (Object.hasOwn(body, "status") && body.status !== job.status) {
      const statusError = await validateJobStatusChange(job, body.status);
      if (statusError) return res.status(409).json({ message: statusError });
    }

    const previousStatus = job.status;
    const changedFields = requestedFields.filter((field) => job.get(field) !== body[field]);
    let updatedJob = job;

    if (changedFields.length > 0) {
      const updates = Object.fromEntries(changedFields.map((field) => [field, body[field]]));
      updatedJob = await Job.findOneAndUpdate(
        {
          _id: job._id,
          ...(changedFields.includes("status") ? { status: previousStatus } : {}),
        },
        { $set: updates },
        { returnDocument: "after", runValidators: true },
      );

      if (!updatedJob) {
        return res.status(409).json({
          message: "Job changed while it was being updated. Refresh and try again.",
        });
      }

      await recordAuditLog(req, {
        action: "update",
        resource: "Job",
        resourceId: updatedJob._id,
        details: {
          operation: "updateAdminJob",
          changedFields,
          ...(changedFields.includes("status")
            ? { previousStatus, status: updatedJob.status }
            : {}),
        },
      });
    }

    const populatedJob = await populateJob(Job.findById(updatedJob._id));
    return res.status(200).json({ message: "Job updated.", job: populatedJob });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deleteJob(req, res) {
  try {
    const [job, proposals, contracts] = await Promise.all([
      Job.findById(req.params.id),
      Proposal.countDocuments({ job: req.params.id }),
      Contract.countDocuments({ "source.type": "job", "source.job": req.params.id }),
    ]);

    if (!job) return res.status(404).json({ message: "Job not found." });

    const references = { proposals, contracts };
    if (proposals > 0 || contracts > 0 || job.status !== "draft") {
      return res.status(409).json({
        message: "Only a draft job with no marketplace history can be deleted. Hide it instead.",
        references,
      });
    }

    // Recheck draft status in the delete itself so a concurrent publish cannot
    // turn the record into marketplace history between validation and removal.
    const deletion = await Job.deleteOne({ _id: job._id, status: "draft" });
    if (deletion.deletedCount === 0) {
      return res.status(409).json({
        message: "Job changed while it was being deleted. Refresh and try again.",
        references,
      });
    }
    await recordAuditLog(req, {
      action: "delete",
      resource: "Job",
      resourceId: job._id,
      affectedCount: deletion.deletedCount,
      details: { operation: "deleteAdminJob", status: job.status },
    });
    return res.status(200).json({ message: "Job deleted." });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getServices(req, res) {
  try {
    const { page, limit, skip, sort, search } = parseListQuery(req.query, SERVICE_SORTS);
    const filter = {};
    applyVisibilityFilter(filter, req.query.visibility);

    if (search) {
      const pattern = new RegExp(escapeRegExp(search), "i");
      const [freelancerIds, packageIds] = await Promise.all([
        User.find({ $or: [{ name: pattern }, { email: pattern }] }).distinct("_id"),
        Package.find({
          $or: [{ name: pattern }, { title: pattern }, { description: pattern }, { features: pattern }],
        }).distinct("_id"),
      ]);
      filter.$or = [
        { name: pattern },
        { freelancer: { $in: freelancerIds } },
        { packages: { $in: packageIds } },
      ];
    }

    const [services, total] = await Promise.all([
      populateService(
        Service.find(filter)
          .select("freelancer name packages images isHidden createdAt updatedAt")
          .sort(sort)
          .skip(skip)
          .limit(limit),
      ).lean(),
      Service.countDocuments(filter),
    ]);

    return res.status(200).json({
      services: services.map((service) => ({ ...service, isHidden: service.isHidden === true })),
      pagination: paginationResult(page, limit, total),
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getService(req, res) {
  try {
    const [service, contracts] = await Promise.all([
      populateService(
        Service.findById(req.params.id).select(
          "freelancer name packages images isHidden createdAt updatedAt",
        ),
      ).lean(),
      Contract.countDocuments({ "source.type": "service", "source.service": req.params.id }),
    ]);

    if (!service) return res.status(404).json({ message: "Service not found." });
    return res.status(200).json({
      service: { ...service, isHidden: service.isHidden === true },
      references: { contracts },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function updateService(req, res) {
  try {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};
    const requestedFields = ["name", "isHidden"].filter((field) => Object.hasOwn(body, field));

    if (requestedFields.length === 0) {
      return res.status(400).json({ message: "Provide name or isHidden to update." });
    }
    if (
      Object.hasOwn(body, "name") &&
      (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 200)
    ) {
      return res.status(400).json({
        message: "Service name must be between 1 and 200 characters.",
      });
    }
    if (Object.hasOwn(body, "isHidden") && typeof body.isHidden !== "boolean") {
      return res.status(400).json({ message: "isHidden must be a boolean." });
    }

    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ message: "Service not found." });

    if (Object.hasOwn(body, "name")) service.name = body.name.trim();
    if (Object.hasOwn(body, "isHidden")) service.isHidden = body.isHidden;
    const changedFields = requestedFields.filter((field) => service.isModified(field));

    if (changedFields.length > 0) {
      await service.save();
      await recordAuditLog(req, {
        action: "update",
        resource: "Service",
        resourceId: service._id,
        details: { operation: "updateAdminService", changedFields },
      });
    }

    const updatedService = await populateService(Service.findById(service._id));
    return res.status(200).json({ message: "Service updated.", service: updatedService });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deleteService(req, res) {
  try {
    const [service, contracts] = await Promise.all([
      Service.findById(req.params.id),
      Contract.countDocuments({ "source.type": "service", "source.service": req.params.id }),
    ]);

    if (!service) return res.status(404).json({ message: "Service not found." });

    const references = { contracts };
    if (contracts > 0) {
      return res.status(409).json({
        message: "Service has marketplace history and cannot be deleted. Hide it instead.",
        references,
      });
    }

    const deletion = await service.deleteOne();
    await recordAuditLog(req, {
      action: "delete",
      resource: "Service",
      resourceId: service._id,
      affectedCount: deletion.deletedCount,
      details: {
        operation: "deleteAdminService",
        packageIds: service.packages,
        packagesPreserved: true,
      },
    });
    return res.status(200).json({ message: "Service deleted." });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  getJobs,
  getJob,
  updateJob,
  deleteJob,
  getServices,
  getService,
  updateService,
  deleteService,
};
