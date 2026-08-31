const Contract = require("../models/Contract");
const ContractMessage = require("../models/ContractMessage");
const User = require("../models/User");
const { recordAuditLog } = require("../services/audit.service");

function participantFilter(req) {
  if (req.user.role === "admin") return { _id: req.params.id };

  return {
    _id: req.params.id,
    $or: [{ client: req.user._id }, { freelancer: req.user._id }],
  };
}

function parsePagination(query) {
  const page = Number.parseInt(query.page, 10);
  const limit = Number.parseInt(query.limit, 10);

  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50,
  };
}

function normalizeAttachments(rawAttachments) {
  if (rawAttachments === undefined) return [];
  if (!Array.isArray(rawAttachments) || rawAttachments.length > 10) return null;

  const attachments = [];

  for (const item of rawAttachments) {
    if (!item || typeof item.url !== "string" || typeof item.name !== "string") return null;

    const url = item.url.trim();
    const name = item.name.trim();

    if (!url || url.length > 2048 || !name || name.length > 180) return null;
    if (!/^https?:\/\//i.test(url)) return null;

    attachments.push({ url, name });
  }

  return attachments;
}

async function getContractMessages(req, res) {
  try {
    const contract = await Contract.findOne(participantFilter(req)).select("_id").lean();

    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found." });
    }

    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;

    const [latestFirst, total] = await Promise.all([
      ContractMessage.find({ contract: contract._id })
        .populate("sender", "name avatarUrl role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ContractMessage.countDocuments({ contract: contract._id }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        messages: latestFirst.reverse(),
        pagination: {
          page,
          limit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    if (err?.name === "CastError") {
      return res.status(404).json({ success: false, message: "Contract not found." });
    }

    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function createContractMessage(req, res) {
  try {
    if (typeof req.body.body !== "string" || !req.body.body.trim()) {
      return res.status(400).json({ success: false, message: "Message is required." });
    }

    const body = req.body.body.trim();
    if (body.length > 4000) {
      return res.status(400).json({ success: false, message: "Message cannot exceed 4000 characters." });
    }

    const attachments = normalizeAttachments(req.body.attachments);
    if (attachments === null) {
      return res.status(400).json({ success: false, message: "Attachments must contain valid URL and name values (maximum 10)." });
    }

    const [contract, user] = await Promise.all([
      Contract.findOne(participantFilter(req)).select("_id client freelancer activity"),
      User.findById(req.user._id).select("status"),
    ]);

    if (!contract) {
      return res.status(404).json({ success: false, message: "Contract not found." });
    }

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (user.status === "suspended") {
      return res.status(403).json({ success: false, message: "Suspended accounts cannot send messages." });
    }

    const message = await ContractMessage.create({
      contract: contract._id,
      sender: req.user._id,
      body,
      attachments,
    });

    contract.activity.push({
      type: "message_sent",
      by: req.user._id,
      message: "Sent a contract message.",
      at: message.createdAt,
    });
    await contract.save();

    await recordAuditLog(req, {
      action: "create",
      resource: "ContractMessage",
      resourceId: message._id,
      details: { operation: "createContractMessage", contractId: contract._id, attachmentCount: attachments.length },
    });

    await message.populate("sender", "name avatarUrl role");

    return res.status(201).json({ success: true, message: "Message sent.", data: { message } });
  } catch (err) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({ success: false, message: err.message });
    }

    if (err?.name === "CastError") {
      return res.status(404).json({ success: false, message: "Contract not found." });
    }

    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

module.exports = {
  getContractMessages,
  createContractMessage,
};
