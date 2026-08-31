// models/Contract.js
const mongoose = require("mongoose");

const CONTRACT_SOURCE_TYPES = ["job", "gig", "service"];
const CONTRACT_STATUSES = ["active", "completed", "cancelled"];
const MILESTONE_STATUSES = [
  "pending", // unfunded
  "funded",
  "in_progress",
  "delivered",
  "revision_requested",
  "approved",
  "disputed",
  "refunded",
  "split",
  "cancelled",
];
const DELIVERY_RESPONSES = ["approved", "revision"];

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    name: { type: String, required: true, trim: true, maxlength: 180 },
  },
  { _id: false }
);

// One submission of work against a milestone (F-CON-04/05).
const deliverySchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    attachments: {
      type: [attachmentSchema],
      validate: {
        validator: (attachments) => attachments.length <= 10,
        message: "A delivery can contain at most 10 attachments.",
      },
    },
    submittedAt: { type: Date, default: Date.now },
    response: { type: String, enum: DELIVERY_RESPONSES },
    responseNote: { type: String, trim: true },
    respondedAt: { type: Date },
  },
  { _id: false }
);

const servicePackageSnapshotSchema = new mongoose.Schema(
  {
    serviceName: { type: String, required: true, trim: true },
    packageName: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, enum: ["USD", "SAR", "AED", "BHD"] },
    deliveryDays: { type: Number, required: true, min: 1 },
    revisions: { type: Number, required: true, min: 0 },
    features: [{ type: String, trim: true }],
  },
  { _id: false },
);

// Milestones live embedded inside the Contract document (always loaded
// together, bounded size) — per the spec's ERD, not a separate collection.
const milestoneSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    dueDate: { type: Date },
    status: {
      type: String,
      enum: MILESTONE_STATUSES,
      default: "pending", // unfunded
    },
    escrowAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliveries: [deliverySchema],
    fundedAt: { type: Date },
    deliveredAt: { type: Date },
    approvedAt: { type: Date },
  },
  { timestamps: true }
);

// F-CON-01: a contract comes from a job+proposal, a legacy gig+tier, or a
// marketplace service+package. Conditional requirements keep each source
// internally complete while preserving older gig records.
const sourceSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: CONTRACT_SOURCE_TYPES,
      required: true,
    },
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: function () {
        return this.type === "job";
      },
    },
    proposal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Proposal",
      required: function () {
        return this.type === "job";
      },
    },
    gig: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gig",
      required: function () {
        return this.type === "gig";
      },
    },
    tier: {
      type: String,
      required: function () {
        return this.type === "gig";
      },
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: function () {
        return this.type === "service";
      },
    },
    package: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Package",
      required: function () {
        return this.type === "service";
      },
    },
    packageSnapshot: {
      type: servicePackageSnapshotSchema,
      required: function () {
        return this.type === "service";
      },
    },
  },
  { _id: false }
);

const contractSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    freelancer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    source: {
      type: sourceSchema,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      enum: ["USD", "SAR", "AED", "BHD"],
      default: "BHD",
    },
    status: {
      type: String,
      enum: CONTRACT_STATUSES,
      default: "active",
      index: true,
    },
    // Successful service checkouts use a hashed key for replay-safe creation.
    // Both fields are private API internals and never expose card data.
    orderReference: { type: String, unique: true, sparse: true, select: false },
    orderRequestHash: { type: String, select: false },
    milestones: {
      type: [milestoneSchema],
      validate: {
        validator: (milestones) => Array.isArray(milestones) && milestones.length >= 1,
        message: "A contract must have at least one milestone.",
      },
    },
    // F-CON-07 (Must): activity log for the contract workspace timeline —
    // who did what, when (funded, delivered, approved, revision, ...).
    activity: [
      {
        _id: false,
        type: { type: String, required: true }, // e.g. 'milestone_funded'
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        message: { type: String, trim: true },
        at: { type: Date, default: Date.now },
      },
    ],
    startedAt: { type: Date },
    completedAt: { type: Date },
    // A single lifecycle timestamp for either terminal state. `completedAt`
    // remains for backwards compatibility with existing contract consumers.
    endedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelReason: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

contractSchema.index({ client: 1, status: 1 });
contractSchema.index({ freelancer: 1, status: 1 });
contractSchema.index({ "source.job": 1 });
contractSchema.index({ "source.service": 1 });

module.exports = mongoose.model("Contract", contractSchema);
