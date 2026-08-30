const mongoose = require("mongoose");

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
  },
  { timestamps: true }
);

serviceSchema.index({ freelancer: 1, name: 1 }, { unique: true });
serviceSchema.index({ packages: 1 }, { unique: true });

module.exports = mongoose.model("Service", serviceSchema);
