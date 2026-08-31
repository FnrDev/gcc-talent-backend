// models/Proposal.js
const mongoose = require("mongoose");

const PROPOSAL_STATUSES = ["pending", "shortlisted", "accepted", "declined", "withdrawn"];

const proposalSchema = new mongoose.Schema(
  {
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    freelancer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    coverLetter: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    deliveryDays: {
      type: Number,
      required: true,
      min: 1,
    },
    // F-PRO-01: optional milestone breakdown. When the proposal is accepted,
    // these are carried into the new Contract's embedded milestones.
    milestones: [
      {
        _id: false,
        title: { type: String, required: true, trim: true, maxlength: 200 },
        description: { type: String, required: true, trim: true, maxlength: 2000 },
        amount: { type: Number, required: true, min: 0 },
        dueDate: { type: Date },
      },
    ],
    attachments: [
      {
        _id: false,
        url: { type: String, required: true, maxlength: 2000 },
        name: { type: String, required: true, maxlength: 255 },
      },
    ],
    status: {
      type: String,
      enum: PROPOSAL_STATUSES,
      default: "pending",
      index: true,
    },
    // F-PRO-03: client may decline with an optional reason.
    declineReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

// F-PRO-05 / F-PRO-01: one proposal per freelancer per job.
proposalSchema.index({ job: 1, freelancer: 1 }, { unique: true });
proposalSchema.path("milestones").validate((milestones) => milestones.length <= 20, "A proposal can have at most 20 milestones.");
proposalSchema.path("attachments").validate((attachments) => attachments.length <= 5, "A proposal can have at most 5 attachments.");

module.exports = mongoose.model("Proposal", proposalSchema);
