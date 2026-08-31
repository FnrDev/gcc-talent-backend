// models/ClientProfile.js
// 1:1 with User (separate collection, unique user ref) — per the spec's
// "Relationships at a glance": keeps the User document lean.
const mongoose = require("mongoose");

const COMPANY_SIZES = ["solo", "2_10", "11_50", "51_200", "201_500", "501_plus"];

const clientProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    companyName: { type: String, trim: true, maxlength: 120 },
    isCompany: { type: Boolean, default: false },
    description: { type: String, trim: true, maxlength: 2000 },
    website: { type: String, trim: true, maxlength: 2048 },
    industry: { type: String, trim: true, maxlength: 100 },
    companySize: { type: String, enum: COMPANY_SIZES },
    foundedYear: {
      type: Number,
      min: 1800,
      max: new Date().getUTCFullYear(),
      validate: {
        validator: Number.isInteger,
        message: "Founded year must be a whole number.",
      },
    },
    // Denormalised counters, updated as jobs are posted / contracts complete.
    jobsPosted: { type: Number, default: 0, min: 0 },
    totalSpent: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

module.exports = mongoose.model("ClientProfile", clientProfileSchema);
