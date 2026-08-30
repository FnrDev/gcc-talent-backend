const mongoose = require("mongoose");

const requestSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    method: { type: String, maxlength: 16 },
    path: { type: String, maxlength: 500 },
    ip: { type: String, maxlength: 64 },
  },
  { _id: false },
);

const auditLogSchema = new mongoose.Schema(
  {
    // Keep the ID even if the account is later deleted. Guests are not attributed
    // to a user merely because they supplied that user's email address.
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorType: { type: String, enum: ["user", "anonymous", "system"], required: true },
    action: { type: String, enum: ["create", "update", "delete"], required: true },
    resource: {
      type: String,
      enum: ["User", "Job", "Proposal", "Contract", "Transaction", "Review", "Category", "Skill", "Service", "FreelancerProfile", "ClientProfile", "Attachment"],
      required: true,
    },
    // Bulk mutations use a null ID, affectedCount, and a scoped details filter.
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    affectedCount: { type: Number, min: 1, default: 1, validate: Number.isSafeInteger },
    details: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    request: { type: requestSchema, required: true },
  },
  {
    collection: "audit_logs",
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    // A disconnected audit write must not sit in Mongoose's command buffer
    // after the business operation has already completed.
    bufferCommands: false,
  },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ resource: 1, resourceId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ "request.id": 1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
