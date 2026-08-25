const bcrypt = require("bcrypt");
const User = require("../models/User");
const jwt = require("jsonwebtoken");

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN = "7d";

function createAccessToken(user) {
  return jwt.sign(
    {
      _id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    }
  );
}

function createRefreshToken(user) {
  return jwt.sign(
    {
      _id: user._id,
      role: user.role,
    },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    }
  );
}

async function signUp(req, res) {
  try {
    const { name, email, password, role } = req.body;

    // Validation
    if (!name || !email || !password || !role) return res.status(400).json({ success: false, message: "name, email, password, and role are required.", });
    if (password.length < 8) return res.status(400).json({ success: false, message: "Password must be atleast 8 characters", });
    if (!["client", "freelancer"].includes(role)) return res.status(400).json({ success: false, message: "Role must be either client or freelancer.", })

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail })

    if (existingUser) return res.status(409).json({ success: false, message: "An account with this email already exists.", });

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      hashedPassword: password,
      role,
    });

    return res.status(201).json({
      success: true,
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          status: user.status,
        },
      }
    })
  } catch (err) {
    console.log(err);

    if (err.name === "ValidationError") {
      return res.status(400).json({success: false, message: err.message,});
    }
    if (err.code === 11000) {
      return res.status(409).json({success: false, message: "An account with this email already exists.",});
    }

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

async function signIn(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({success: false, message: "Email and password are required.",});
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail })
      .select("+hashedPassword +refreshTokenHash");

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    if (user.status === "suspended") {
      return res.status(403).json({ success: false, message: "This account has been suspended." });
    }

    const isPasswordCorrect = await user.comparePassword(password)
    if (!isPasswordCorrect) {
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }


    const accessToken = createAccessToken(user);
    const refreshToken = createRefreshToken(user);

    user.refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    user.lastLoginAt = new Date();

    await user.save();

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      data: {
        accessToken,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          status: user.status,
        },
      },
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

async function refresh(req, res) {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ success: false, message: "Refresh token is required.", });
    }

    let decoded;

    try {
      decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET
      );
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token.",
      });
    }

    const user = await User.findById(decoded._id).select(
      "+refreshTokenHash"
    );

    if (!user || !user.refreshTokenHash) {
      return res.status(401).json({ success: false, message: "Invalid refresh token.", });
    }

    if (user.status === "suspended") {
      return res.status(403).json({ success: false, message: "This account has been suspended.", });
    }

    const isRefreshTokenValid = await bcrypt.compare(refreshToken, user.refreshTokenHash);

    if (!isRefreshTokenValid) {
      return res.status(401).json({ success: false, message: "Invalid refresh token.", });
    }

    const newAccessToken = createAccessToken(user);
    const newRefreshToken = createRefreshToken(user);

    user.refreshTokenHash = await bcrypt.hash(newRefreshToken, 12);

    await user.save();

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

async function logout(req, res) {
  try {
    const user = await User.findById(req.user._id).select(
      "+refreshTokenHash"
    );

    if (user) {
      user.refreshTokenHash = undefined;
      await user.save();
    }

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    return res.status(200).json({ success: true, message: "Logged out successfully.", });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error", });
  }
}

async function getCurrentUser(req, res) {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found.", });
    }

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
          ratingAvg: user.ratingAvg,
          ratingCount: user.ratingCount,
        },
      },
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error", });
  }
}

module.exports = {
  signUp,
  signIn,
  refresh,
  logout,
  getCurrentUser,
};