const mongoose = require("mongoose");

const messageAttachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    name: { type: String, required: true, trim: true, maxlength: 180 },
  },
  { _id: false },
);

const contractMessageSchema = new mongoose.Schema(
  {
    contract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contract",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 4000,
    },
    attachments: {
      type: [messageAttachmentSchema],
      default: [],
      validate: {
        validator: (attachments) => attachments.length <= 10,
        message: "A message can contain at most 10 attachments.",
      },
    },
  },
  { timestamps: true },
);

contractMessageSchema.index({ contract: 1, createdAt: -1 });

module.exports = mongoose.model("ContractMessage", contractMessageSchema);
