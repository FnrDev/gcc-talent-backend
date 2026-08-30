const bcrypt = require("bcrypt");
const User = require('../models/User')
const { getTokenVersion, tokenVersionFilter } = require("../services/session.service");
const { recordAuditLog } = require("../services/audit.service");

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== "string" || !currentPassword || typeof newPassword !== "string" || !newPassword) {
      return res.status(400).json({success: false, message: "Current password and new password are required.",});
    }

    if (newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
      return res.status(400).json({ success: false, message: "New password must contain at least 8 characters and no more than 72 UTF-8 bytes.",});
    }

    const user = await User.findById(req.user._id).select(
      "+hashedPassword +refreshTokenHash +tokenVersion"
    );

    if (!user) {
      return res.status(404).json({success: false, message: "User not found.", });
    }
    if (getTokenVersion(user) !== getTokenVersion(req.user)) {
      return res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    }

    const isCurrentPasswordCorrect = await user.comparePassword(currentPassword);

    if (!isCurrentPasswordCorrect) {
      return res.status(401).json({success: false, message: "Current password is incorrect.", });
    }

    const isSamePassword = await user.comparePassword(newPassword);

    if (isSamePassword) {
      return res.status(400).json({success: false, message: "New password must be different from the current password.",});
    }

    const updated = await User.updateOne(
      { _id: user._id, hashedPassword: user.hashedPassword, status: { $ne: "suspended" }, ...tokenVersionFilter(user) },
      {
        $set: { hashedPassword: await bcrypt.hash(newPassword, 10) },
        $inc: { tokenVersion: 1 },
        $unset: { refreshTokenHash: 1, passwordResetTokenHash: 1, passwordResetExpiresAt: 1, passwordResetSentAt: 1 },
      },
      { runValidators: true },
    );
    if (!updated.matchedCount) {
      return res.status(401).json({ success: false, message: "Your credentials changed. Please sign in again." });
    }

    if (updated.modifiedCount > 0) {
      await recordAuditLog(req, {
        action: "update",
        resource: "User",
        resourceId: user._id,
        details: { operation: "changePassword", changedFields: ["credentials", "sessions", "recovery"] },
      });
    }

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    return res.status(200).json({success: true, message: "Password changed successfully. Please log in again.",});

  } catch (err) {
    console.error(err);

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

async function updatePreferences(req, res) {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({success: false, message: "User not found.",});
    }

    const { email } = req.body;

    if (email !== undefined && typeof email !== "boolean") {
      return res.status(400).json({success: false, message: "Email preference must be a boolean.",});
    }

    if (email !== undefined) {
      user.notificationPrefs.email = email;
    }

    const preferencesChanged = user.isModified("notificationPrefs.email");
    await user.save();
    if (preferencesChanged) {
      await recordAuditLog(req, {
        action: "update",
        resource: "User",
        resourceId: user._id,
        details: { operation: "updatePreferences", changedFields: ["notificationPrefs.email"] },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        preferences: {
          email: user.notificationPrefs.email,
        },
      },
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

module.exports = {
  changePassword,
  updatePreferences,
};
