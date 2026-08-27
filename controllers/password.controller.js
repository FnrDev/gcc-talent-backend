const crypto = require("node:crypto");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const {
  getPasswordResetConfiguration,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
} = require("../services/email.service");

const RESET_LIFETIME_MS = 30 * 60 * 1000;
const RESET_COOLDOWN_MS = 60 * 1000;
const RESET_FIELDS = ["passwordResetTokenHash", "passwordResetExpiresAt", "passwordResetSentAt"];
const REQUEST_MESSAGE = "If an account with that email exists, you will receive a password reset link shortly.";

function invalidResetToken(res) {
  return res.status(400).json({
    success: false,
    code: "INVALID_RESET_TOKEN",
    message: "This password reset link is invalid or expired. Please request a new link.",
  });
}

async function forgotPassword(req, res) {
  res.set("Cache-Control", "no-store");
  const { email } = req.body || {};
  if (typeof email !== "string" || email.trim().length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.trim())) {
    return res.status(400).json({ success: false, message: "A valid email address is required." });
  }

  let configuration;
  try {
    // Check global availability before looking up an account, so failures cannot identify users.
    configuration = getPasswordResetConfiguration();
    if (User.db.readyState !== 1) throw new Error("Database unavailable");
  } catch (_) {
    console.error("Password reset is unavailable due to service configuration or database connectivity.");
    return res.status(503).json({ success: false, message: "Password reset is temporarily unavailable. Please try again later." });
  }

  // Respond before account lookup or provider work. Neither account existence nor email latency
  // changes the public response. The handler still awaits and catches all background work.
  res.status(200).json({ success: true, message: REQUEST_MESSAGE });

  try {
    const now = new Date();
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const previous = await User.findOneAndUpdate(
      {
        email: email.trim().toLowerCase(),
        status: { $ne: "suspended" },
        $or: [
          { passwordResetSentAt: { $lte: new Date(now.getTime() - RESET_COOLDOWN_MS) } },
          { passwordResetSentAt: null },
        ],
      },
      {
        $set: {
          passwordResetTokenHash: tokenHash,
          passwordResetExpiresAt: new Date(now.getTime() + RESET_LIFETIME_MS),
          passwordResetSentAt: now,
        },
      },
      { returnDocument: "before" },
    ).select(`name email ${RESET_FIELDS.map((field) => `+${field}`).join(" ")}`);

    if (!previous) return;

    try {
      await sendPasswordResetEmail({ user: previous, token, configuration });
    } catch (err) {
      if (err.deliveryUnconfirmed === false) {
        // Restore the previous link only on definite rejection. Retain the new attempt time
        // to enforce the per-account cooldown even if the provider is rejecting requests.
        const restore = { $set: {}, $unset: {} };
        for (const field of ["passwordResetTokenHash", "passwordResetExpiresAt"]) {
          if (previous[field] === undefined) restore.$unset[field] = 1;
          else restore.$set[field] = previous[field];
        }
        if (!Object.keys(restore.$set).length) delete restore.$set;
        if (!Object.keys(restore.$unset).length) delete restore.$unset;
        await User.updateOne({ _id: previous._id, passwordResetTokenHash: tokenHash }, restore);
      }
      // A lost provider response may still mean the email was delivered; retain its token.
      console.error("Password reset email delivery failed or could not be confirmed.");
    }
  } catch (_) {
    console.error("Password reset request could not be processed.");
  }
}

async function resetPassword(req, res) {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const { token, newPassword } = req.body || {};
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return invalidResetToken(res);
  if (typeof newPassword !== "string" || newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({
      success: false,
      code: "INVALID_PASSWORD",
      message: "Password must contain at least 8 characters and no more than 72 UTF-8 bytes.",
    });
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const filter = {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
      status: { $ne: "suspended" },
    };
    const eligible = await User.findOne(filter).select("_id");
    if (!eligible) return invalidResetToken(res);

    // Query updates do not execute Mongoose's pre-save password hook; hash exactly once here.
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const user = await User.findOneAndUpdate(
      { ...filter, _id: eligible._id, passwordResetExpiresAt: { $gt: new Date() } },
      {
        $set: { hashedPassword },
        $inc: { tokenVersion: 1 },
        $unset: {
          refreshTokenHash: 1,
          ...Object.fromEntries(RESET_FIELDS.map((field) => [field, 1])),
        },
      },
      { new: true, runValidators: true },
    ).select("name email");
    if (!user) return invalidResetToken(res);

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    res.status(200).json({ success: true, message: "Password reset successfully. Please sign in with your new password." });

    try {
      await sendPasswordChangedEmail({ user, configuration: getPasswordResetConfiguration(), idempotencyKey: tokenHash });
    } catch (_) {
      // Notification failure must not undo the password change or expose the new password.
      console.error("Password changed notification could not be delivered.");
    }
  } catch (_) {
    console.error("Password reset failed.");
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: "Password could not be reset. Please try again later." });
    }
  }
}

module.exports = { forgotPassword, resetPassword };
