const bcrypt = require("bcrypt");
const User = require('../models/User')

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({success: false, message: "Current password and new password are required.",});
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters.",});
    }

    const user = await User.findById(req.user._id).select(
      "+hashedPassword +refreshTokenHash"
    );

    if (!user) {
      return res.status(404).json({success: false, message: "User not found.", });
    }

    const isCurrentPasswordCorrect = await user.comparePassword(currentPassword);

    if (!isCurrentPasswordCorrect) {
      return res.status(401).json({success: false, message: "Current password is incorrect.", });
    }

    const isSamePassword = await user.comparePassword(newPassword);

    if (isSamePassword) {
      return res.status(400).json({success: false, message: "New password must be different from the current password.",});
    }

    user.hashedPassword = newPassword;
    user.refreshTokenHash = undefined;

    await user.save();

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

    await user.save();

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