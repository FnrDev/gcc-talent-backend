// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const USER_ROLES = ["client", "freelancer", "admin"];
const USER_STATUSES = ["active", "suspended"];
const AVAILABILITY = ["full_time", "part_time", "unavailable"];
const CURRENCIES = ["USD", "SAR", "AED", "BHD"];

// Embedded, not a separate collection: holds both freelancer-side and
// client-side profile fields on the same User document (per the ERD,
// `profile` is a single `object` field on User, not a linked collection).
const profileSchema = new mongoose.Schema(
  {
    avatarUrl: { type: String, trim: true },
    bio: { type: String, trim: true },
    country: { type: String, trim: true },
    city: { type: String, trim: true },

    // Freelancer-side fields
    headline: { type: String, trim: true },
    skills: [{ type: mongoose.Schema.Types.ObjectId, ref: "Skill" }],
    hourlyRate: { type: Number, min: 0 },
    currency: { type: String, enum: CURRENCIES, default: "USD" },
    availability: { type: String, enum: AVAILABILITY },
    languages: [
      {
        _id: false,
        name: { type: String, trim: true },
        level: { type: String, trim: true },
      },
    ],
    portfolio: [
      {
        _id: false,
        title: { type: String, trim: true },
        description: { type: String, trim: true },
        imageUrl: { type: String, trim: true },
        link: { type: String, trim: true },
      },
    ],

    // Client-side fields
    companyName: { type: String, trim: true },
    isCompany: { type: Boolean, default: false },
    website: { type: String, trim: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    // Plain password is hashed into this field by the pre-save hook below.
    hashedPassword: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      required: true,
    },
    profile: {
      type: profileSchema,
      default: () => ({}),
    },
    wallet: {
      available: { type: Number, default: 0, min: 0 },
      pending: { type: Number, default: 0, min: 0 },
    },
    ratingAvg: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: "active",
    },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

// Hash the password whenever a plain-text password is assigned to
// `hashedPassword` (e.g. userDoc.hashedPassword = plainPassword; userDoc.save()).
userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("hashedPassword")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.hashedPassword = await bcrypt.hash(this.hashedPassword, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = function comparePassword(plainPassword) {
  return bcrypt.compare(plainPassword, this.hashedPassword);
};

userSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.hashedPassword;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
