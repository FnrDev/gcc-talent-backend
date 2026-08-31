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
    // Milestones are embedded in Contract, so this stores their ObjectId
    // without a separate collection reference.
    milestoneId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
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
    currency: {
      type: String,
      enum: ["BHD"],
      default: "BHD",
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
    // Hash of the canonical request body. It allows a repeated
    // Idempotency-Key to be replayed safely while rejecting key reuse with a
    // different amount or payment payload. This value is never returned.
    requestHash: {
      type: String,
      select: false,
    },
    failureCode: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

transactionSchema.index({ user: 1, createdAt: -1 });

transactionSchema.set("toJSON", {
  transform: (_document, value) => {
    delete value.requestHash;
    return value;
  },
});

module.exports = mongoose.model("Transaction", transactionSchema);
