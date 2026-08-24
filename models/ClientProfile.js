// models/ClientProfile.js
// 1:1 with User (separate collection, unique user ref) — per the spec's
// "Relationships at a glance": keeps the User document lean.
const mongoose = require("mongoose");

const clientProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    companyName: { type: String, trim: true },
    isCompany: { type: Boolean, default: false },
    description: { type: String },
    website: { type: String },
    // Denormalised counters, updated as jobs are posted / contracts complete.
    jobsPosted: { type: Number, default: 0, min: 0 },
    totalSpent: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

module.exports = mongoose.model("ClientProfile", clientProfileSchema);
