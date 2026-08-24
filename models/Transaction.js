// models/Transaction.js
const mongoose = require("mongoose");

const TRANSACTION_TYPES = [
  "deposit",
  "escrow_fund",
  "escrow_release",
  "escrow_refund",
  "platform_fee",
  "withdrawal",
];
const TRANSACTION_DIRECTIONS = ["credit", "debit"];
const TRANSACTION_STATUSES = ["completed", "failed"];

const transactionSchema = new mongoose.Schema(
  {
    // Wallet owner. Left null for platform-only entries (e.g. platform_fee
    // ledger rows that aren't attached to a specific user's wallet view).
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    contract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contract",
      index: true,
    },
    // References the embedded Contract.milestones._id this transaction relates to.
    milestoneId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    type: {
      type: String,
      enum: TRANSACTION_TYPES,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0, // always positive; sign is carried by `direction`
    },
    direction: {
      type: String,
      enum: TRANSACTION_DIRECTIONS,
      required: true,
    },
    status: {
      type: String,
      enum: TRANSACTION_STATUSES,
      default: "completed",
    },
    // Idempotency key so a retried request can't double-credit/debit (F-PAY-07).
    reference: {
      type: String,
      required: true,
      unique: true,
    },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

transactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
