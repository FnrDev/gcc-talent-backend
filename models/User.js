// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const USER_ROLES = ["client", "freelancer", "admin"];
const USER_STATUSES = ["active", "suspended"];

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
    avatarUrl: {
      type: String,
    },
    // F-AUTH-05: email verification flag shown on profile.
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: "active",
    },
    country: { type: String },
    city: { type: String },
    // F-REV-02: average rating AND review count, both denormalised on the
    // user and recalculated whenever a new review is created.
    ratingAvg: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // F-PAY-01: simulated wallet. available = spendable now,
    // pending = amounts on the way in (not yet released).
    wallet: {
      available: { type: Number, default: 0, min: 0 },
      pending: { type: Number, default: 0, min: 0 },
    },
    notificationPrefs: {
      email: { type: Boolean, default: true },
    },
    // F-AUTH-02/03: hash of the current refresh token — lets logout
    // invalidate it and lets the API detect token reuse on rotation.
    refreshTokenHash: {
      type: String,
      select: false,
    },
    lastLoginAt: {
      type: Date,
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
    delete ret.refreshTokenHash;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
