const mongoose = require("mongoose");

const idempotencyRecordSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    operation: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    // Raw client keys and request bodies are never stored.
    keyHash: { type: String, required: true, select: false },
    requestHash: { type: String, required: true, select: false },
    responseStatus: { type: Number, required: true, min: 200, max: 599 },
    responseBody: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

idempotencyRecordSchema.index({ user: 1, operation: 1, keyHash: 1 }, { unique: true });

module.exports = mongoose.model("IdempotencyRecord", idempotencyRecordSchema);
