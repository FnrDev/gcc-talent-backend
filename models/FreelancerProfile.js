// models/FreelancerProfile.js
// 1:1 with User (separate collection, unique user ref) — per the spec's
// "Relationships at a glance": keeps the User document lean.
const mongoose = require("mongoose");

const AVAILABILITY = ["full_time", "part_time", "unavailable"];
const CURRENCIES = ["USD", "SAR", "AED", "BHD"];

const freelancerProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    headline: { type: String, trim: true },
    bio: { type: String },
    skills: [{ type: mongoose.Schema.Types.ObjectId, ref: "Skill" }],
    hourlyRate: { type: Number, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: "USD" },
    languages: [
      {
        _id: false,
        name: { type: String, trim: true },
        level: { type: String, trim: true }, // e.g. 'native' | 'fluent' | 'conversational'
      },
    ],
    availability: {
      type: String,
      enum: AVAILABILITY,
      default: "full_time",
    },
    portfolio: [
      {
        title: { type: String, trim: true },
        description: { type: String },
        imageUrl: { type: String },
        link: { type: String },
      },
    ],
    // Denormalised counters, updated when contracts complete.
    completedContracts: { type: Number, default: 0, min: 0 },
    totalEarned: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

module.exports = mongoose.model("FreelancerProfile", freelancerProfileSchema);
