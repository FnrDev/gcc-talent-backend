// models/Contract.js
const mongoose = require("mongoose");

const CONTRACT_SOURCE_TYPES = ["job", "gig"];
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
    url: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false }
);

// One submission of work against a milestone (F-CON-04/05).
const deliverySchema = new mongoose.Schema(
  {
    message: { type: String, trim: true },
    attachments: [attachmentSchema],
    submittedAt: { type: Date, default: Date.now },
    response: { type: String, enum: DELIVERY_RESPONSES },
    responseNote: { type: String, trim: true },
    respondedAt: { type: Date },
  },
  { _id: false }
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

// F-CON-01: a contract comes from either a job+proposal (Upwork style)
// or a gig+tier (Fiverr style). The conditional `required` functions make
// the right pair mandatory for each source type.
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
      type: String, // 'basic' | 'standard' | 'premium'
      required: function () {
        return this.type === "gig";
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
      default: "USD",
    },
    status: {
      type: String,
      enum: CONTRACT_STATUSES,
      default: "active",
      index: true,
    },
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
  },
  { timestamps: true } // adds createdAt + updatedAt
);

contractSchema.index({ client: 1, status: 1 });
contractSchema.index({ freelancer: 1, status: 1 });
contractSchema.index({ "source.job": 1 });

module.exports = mongoose.model("Contract", contractSchema);
