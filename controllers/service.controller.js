const mongoose = require("mongoose");
const Package = require("../models/Package");
const Service = require("../models/Service");
const User = require("../models/User");
const { recordAuditLog } = require("../services/audit.service");
const {
  SERVICE_IMAGE_PURPOSE,
  verifyUploadReceipt,
} = require("../services/uploadReceipt.service");

const DEFAULT_PAGE_SIZE = 9;
const MAX_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 100;
const MAX_SERVICE_IMAGES = 5;
const MAX_SERVICE_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const SERVICE_IMAGE_EXTENSIONS = new Map([
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const SERVICE_SORTS = {
  recommended: { recommendationScore: -1, ratingAvg: -1, createdAt: -1, _id: -1 },
  newest: { createdAt: -1, _id: -1 },
  price_low: { startingPrice: 1, createdAt: -1, _id: -1 },
  price_high: { startingPrice: -1, createdAt: -1, _id: -1 },
  delivery: { fastestDelivery: 1, createdAt: -1, _id: -1 },
  rating: { ratingAvg: -1, ratingCount: -1, createdAt: -1, _id: -1 },
};

class QueryValidationError extends Error {}

function handleError(res, err) {
  if (err instanceof QueryValidationError) {
    return res.status(400).json({ success: false, message: err.message });
  }

  if (err?.code === 11000) {
    if (err.keyPattern?.packages || err.keyValue?.packages) {
      return res.status(409).json({
        success: false,
        message: "One or more packages already belong to another service.",
      });
    }

    return res.status(409).json({
      success: false,
      message: "You already have a service with that name.",
    });
  }

  if (err?.name === "ValidationError" || err?.name === "CastError") {
    return res.status(400).json({ success: false, message: err.message });
  }

  if (err?.code === "UPLOAD_RECEIPT_CONFIGURATION_ERROR") {
    return res.status(503).json({ success: false, message: "Service images are temporarily unavailable." });
  }

  console.error(err);
  return res.status(500).json({ success: false, message: "Internal Server Error" });
}

function positiveInteger(value, fallback, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new QueryValidationError(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new QueryValidationError(`${name} must be a positive integer.`);
  }

  return Math.min(parsed, maximum);
}

function parseListQuery(query) {
  const page = positiveInteger(query.page, 1, "page");
  const limit = positiveInteger(query.limit, DEFAULT_PAGE_SIZE, "limit", MAX_PAGE_SIZE);
  const deliveryDays = query.deliveryDays === undefined
    ? undefined
    : positiveInteger(query.deliveryDays, undefined, "deliveryDays", 365);
  const sort = query.sort || "recommended";

  if (typeof sort !== "string" || !SERVICE_SORTS[sort]) {
    throw new QueryValidationError("Invalid service sort option.");
  }

  if (query.search !== undefined && typeof query.search !== "string") {
    throw new QueryValidationError("search must be a single string value.");
  }

  const search = String(query.search || "").trim();
  if (search.length > MAX_SEARCH_LENGTH) {
    throw new QueryValidationError(`search must be at most ${MAX_SEARCH_LENGTH} characters.`);
  }

  return { page, limit, deliveryDays, sort, search };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serviceViewPipeline(initialMatch = {}) {
  const pipeline = [{ $match: { ...initialMatch, isHidden: { $ne: true } } }];

  pipeline.push(
    {
      $lookup: {
        from: Package.collection.name,
        let: { packageIds: "$packages", freelancerId: "$freelancer" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$_id", "$$packageIds"] },
                  { $eq: ["$freelancer", "$$freelancerId"] },
                  { $eq: ["$isActive", true] },
                ],
              },
            },
          },
          { $sort: { sortOrder: 1, price: 1, createdAt: 1 } },
          {
            $project: {
              name: 1,
              title: 1,
              description: 1,
              price: 1,
              currency: 1,
              deliveryDays: 1,
              revisions: 1,
              features: 1,
              sortOrder: 1,
            },
          },
        ],
        as: "packages",
      },
    },
    { $match: { "packages.0": { $exists: true } } },
    {
      $lookup: {
        from: User.collection.name,
        let: { freelancerId: "$freelancer" },
        pipeline: [
          {
            $match: {
              role: "freelancer",
              status: "active",
              $expr: { $eq: ["$_id", "$$freelancerId"] },
            },
          },
          {
            $project: {
              name: 1,
              avatarUrl: 1,
              country: 1,
              city: 1,
              ratingAvg: 1,
              ratingCount: 1,
            },
          },
        ],
        as: "freelancer",
      },
    },
    { $unwind: "$freelancer" },
    {
      $set: {
        startingPrice: { $min: "$packages.price" },
        fastestDelivery: { $min: "$packages.deliveryDays" },
        ratingAvg: { $ifNull: ["$freelancer.ratingAvg", 0] },
        ratingCount: { $ifNull: ["$freelancer.ratingCount", 0] },
        recommendationScore: {
          $multiply: [
            { $ifNull: ["$freelancer.ratingAvg", 0] },
            { $ifNull: ["$freelancer.ratingCount", 0] },
          ],
        },
      },
    }
  );

  return pipeline;
}

const PUBLIC_SERVICE_PROJECT = {
  _id: 1,
  name: 1,
  images: 1,
  freelancer: 1,
  packages: 1,
  startingPrice: 1,
  fastestDelivery: 1,
  ratingAvg: 1,
  ratingCount: 1,
  createdAt: 1,
  updatedAt: 1,
};

async function findServiceView(id) {
  const [service] = await Service.aggregate([
    ...serviceViewPipeline({ _id: new mongoose.Types.ObjectId(id) }),
    { $project: PUBLIC_SERVICE_PROJECT },
  ]);

  return service || null;
}

async function getServices(req, res) {
  try {
    const { page, limit, deliveryDays, sort, search } = parseListQuery(req.query);
    const pipeline = serviceViewPipeline();

    if (search) {
      const pattern = new RegExp(escapeRegExp(search), "i");
      pipeline.push({
        $match: {
          $or: [
            { name: pattern },
            { "freelancer.name": pattern },
            { "packages.name": pattern },
            { "packages.title": pattern },
            { "packages.description": pattern },
            { "packages.features": pattern },
          ],
        },
      });
    }

    if (deliveryDays !== undefined) {
      pipeline.push({ $match: { fastestDelivery: { $lte: deliveryDays } } });
    }

    pipeline.push(
      { $sort: SERVICE_SORTS[sort] },
      {
        $facet: {
          services: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $project: PUBLIC_SERVICE_PROJECT },
          ],
          totals: [{ $count: "count" }],
        },
      }
    );

    const [result] = await Service.aggregate(pipeline);
    const total = result?.totals?.[0]?.count || 0;

    return res.status(200).json({
      success: true,
      data: {
        services: result?.services || [],
        pagination: {
          page,
          limit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function getService(req, res) {
  try {
    const service = await findServiceView(req.params.id);

    if (!service) {
      return res.status(404).json({ success: false, message: "Service not found." });
    }

    return res.status(200).json({ success: true, data: { service } });
  } catch (err) {
    return handleError(res, err);
  }
}

async function getSimilarServices(req, res) {
  try {
    const limit = positiveInteger(req.query.limit, 6, "limit", 12);
    const service = await findServiceView(req.params.id);

    if (!service) {
      return res.status(404).json({ success: false, message: "Service not found." });
    }

    const services = await Service.aggregate([
      ...serviceViewPipeline({
        _id: { $ne: service._id },
        freelancer: service.freelancer._id,
      }),
      { $sort: SERVICE_SORTS.recommended },
      { $limit: limit },
      { $project: PUBLIC_SERVICE_PROJECT },
    ]);

    return res.status(200).json({ success: true, data: { services } });
  } catch (err) {
    return handleError(res, err);
  }
}

function validatePackages(packages) {
  if (!Array.isArray(packages) || packages.length === 0) {
    return { error: "A service must include at least one package." };
  }

  if (packages.some((packageId) => !mongoose.isObjectIdOrHexString(packageId))) {
    return { error: "Every package must be a valid package ID." };
  }

  const packageIds = packages.map((packageId) =>
    new mongoose.Types.ObjectId(packageId).toHexString()
  );

  if (new Set(packageIds).size !== packageIds.length) {
    return { error: "A service cannot include the same package more than once." };
  }

  return { packageIds };
}

function isOwnedUploadUrl(value, userId, contentType) {
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || "").trim();
  const extension = SERVICE_IMAGE_EXTENSIONS.get(contentType);
  if (!publicBaseUrl || !extension) return false;

  try {
    const base = new URL(publicBaseUrl);
    const imageUrl = new URL(value);
    const pathname = decodeURIComponent(imageUrl.pathname);
    const basePath = base.pathname.replace(/\/+$/, "");
    const expectedPrefix = `${basePath}/attachments/${String(userId)}/`;

    return (
      imageUrl.protocol === "https:" &&
      imageUrl.origin === base.origin &&
      !imageUrl.username &&
      !imageUrl.password &&
      !imageUrl.search &&
      !imageUrl.hash &&
      pathname.startsWith(expectedPrefix) &&
      pathname.toLowerCase().endsWith(extension)
    );
  } catch (_) {
    return false;
  }
}

function validateServiceImages(images, userId) {
  if (images === undefined) return { serviceImages: [] };
  if (!Array.isArray(images)) return { error: "Service images must be an array." };
  if (images.length > MAX_SERVICE_IMAGES) {
    return { error: `A service can include at most ${MAX_SERVICE_IMAGES} images.` };
  }

  const serviceImages = [];
  const imageUrls = new Set();

  for (const image of images) {
    if (!image || typeof image !== "object" || Array.isArray(image)) {
      return { error: "Every service image must include valid upload metadata." };
    }

    const url = typeof image.url === "string" ? image.url.trim() : "";
    const name = typeof image.name === "string" ? image.name.trim() : "";
    const contentType = typeof image.contentType === "string" ? image.contentType.trim() : "";
    const receipt = typeof image.receipt === "string" ? image.receipt : "";
    const size = image.size;

    if (!url || url.length > 2048 || !name || name.length > 180) {
      return { error: "Every service image must include a valid URL and file name." };
    }
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_SERVICE_IMAGE_SIZE_BYTES) {
      return { error: "Every service image must be 10 MB or smaller." };
    }
    if (!SERVICE_IMAGE_EXTENSIONS.has(contentType)) {
      return { error: "Service images must be JPEG, PNG, WebP, or GIF files." };
    }
    if (!isOwnedUploadUrl(url, userId, contentType)) {
      return { error: "Every service image must be uploaded by the current freelancer." };
    }
    if (!verifyUploadReceipt(receipt, {
      attachment: { url, name, size, contentType },
      userId,
      purpose: SERVICE_IMAGE_PURPOSE,
    })) {
      return { error: "Every service image must include a valid upload receipt." };
    }
    if (imageUrls.has(url)) {
      return { error: "A service cannot include the same image more than once." };
    }

    imageUrls.add(url);
    serviceImages.push({ url, name, size, contentType });
  }

  return { serviceImages };
}

async function createService(req, res) {
  try {
    const user = await User.findById(req.user._id).select("role status");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (user.role !== "freelancer") {
      return res.status(403).json({
        success: false,
        message: "Only freelancers can create services.",
      });
    }

    if (user.status === "suspended") {
      return res.status(403).json({
        success: false,
        message: "Suspended accounts cannot create services.",
      });
    }

    const { name, packages, images } = req.body || {};

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Service name is required.",
      });
    }

    const { error, packageIds } = validatePackages(packages);

    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const { error: imageError, serviceImages } = validateServiceImages(images, user._id);

    if (imageError) {
      return res.status(400).json({ success: false, message: imageError });
    }

    const ownedPackageCount = await Package.countDocuments({
      _id: { $in: packageIds },
      freelancer: user._id,
      isActive: true,
    });

    if (ownedPackageCount !== packageIds.length) {
      return res.status(404).json({
        success: false,
        message: "One or more packages were not found.",
      });
    }

    const linkedService = await Service.exists({ packages: { $in: packageIds } });

    if (linkedService) {
      return res.status(409).json({
        success: false,
        message: "One or more packages already belong to another service.",
      });
    }

    const service = await Service.create({
      freelancer: user._id,
      name: name.trim(),
      packages: packageIds,
      images: serviceImages,
    });

    await recordAuditLog(req, {
      action: "create",
      resource: "Service",
      resourceId: service._id,
      details: {
        operation: "createService",
        name: service.name,
        packages: service.packages,
        imageCount: service.images.length,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Service created successfully.",
      data: { service },
    });
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = { createService, getServices, getService, getSimilarServices };
