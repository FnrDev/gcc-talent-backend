const mongoose = require("mongoose");

const SERVICE_IMAGE_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"];

const serviceImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    name: { type: String, required: true, trim: true, maxlength: 180 },
    size: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024 },
    contentType: { type: String, required: true, enum: SERVICE_IMAGE_TYPES },
  },
  { _id: false },
);

const serviceSchema = new mongoose.Schema(
  {
    freelancer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    packages: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Package",
          required: true,
        },
      ],
      required: true,
      validate: [
        {
          validator: (packages) => packages.length > 0,
          message: "A service must include at least one package.",
        },
        {
          validator: (packages) =>
            new Set(packages.map((packageId) => packageId.toString())).size === packages.length,
          message: "A service cannot include the same package more than once.",
        },
      ],
    },
    images: {
      type: [serviceImageSchema],
      default: [],
      validate: {
        validator: (images) => images.length <= 5,
        message: "A service can include at most five images.",
      },
    },
    // Admin moderation keeps historical service records intact while removing
    // the listing from public discovery and new checkout attempts.
    isHidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

serviceSchema.index({ freelancer: 1, name: 1 }, { unique: true });
serviceSchema.index({ packages: 1 }, { unique: true });
serviceSchema.index({ isHidden: 1, createdAt: -1 });

module.exports = mongoose.model("Service", serviceSchema);
