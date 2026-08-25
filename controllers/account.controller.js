const bcrypt = require("bcrypt");
const User = require('../models/User')

async function updateAccount(req, res) {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({success: false, message: "User not found.",});
    }

    const { name, email, avatarUrl, country, city } = req.body;

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({success: false, message: "Name can not be empty.",});
      }
      user.name = name.trim();
    }

    if (email !== undefined) {
      if (typeof email !== "string" || !email.trim()) {
        return res.status(400).json({success: false, message: "Email can not be empty.",});
      }

      const normalizedEmail = email.toLowerCase().trim();

      if (normalizedEmail !== user.email) {
        const existingUser = await User.findOne({email: normalizedEmail, _id: { $ne: user._id },});

        if (existingUser) {
          return res.status(409).json({success: false, message: "An account with this email already exists.",});
        }

        user.email = normalizedEmail;
        user.isEmailVerified = false;
      }
    }

    if (avatarUrl !== undefined) {
      user.avatarUrl = avatarUrl;
    }

    if (country !== undefined) {
      user.country = country;
    }

    if (city !== undefined) {
      user.city = city;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatarUrl: user.avatarUrl,
          isEmailVerified: user.isEmailVerified,
          status: user.status,
          country: user.country,
          city: user.city,
        },
      },
    });
  } catch (err) {
    console.error(err);

    if (err.name === "ValidationError") {
      return res.status(400).json({success: false, message: err.message,});
    }

    if (err.code === 11000) {
      return res.status(409).json({success: false, message: "An account with this email already exists.",});
    }

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

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
  updateAccount,
  changePassword,
  updatePreferences,
};