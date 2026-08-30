const mongoose = require("mongoose");
const Package = require("../models/Package");
const Service = require("../models/Service");
const User = require("../models/User");
const { recordAuditLog } = require("../services/audit.service");

function handleError(res, err) {
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

  console.error(err);
  return res.status(500).json({ success: false, message: "Internal Server Error" });
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

    const { name, packages } = req.body || {};

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
    });

    await recordAuditLog(req, {
      action: "create",
      resource: "Service",
      resourceId: service._id,
      details: {
        operation: "createService",
        name: service.name,
        packages: service.packages,
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

module.exports = { createService };
