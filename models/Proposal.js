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
    status: {
      type: String,
      enum: PROPOSAL_STATUSES,
      default: "pending",
      index: true,
    },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

// F-PRO-05 / F-PRO-01: one proposal per freelancer per job.
proposalSchema.index({ job: 1, freelancer: 1 }, { unique: true });

module.exports = mongoose.model("Proposal", proposalSchema);
