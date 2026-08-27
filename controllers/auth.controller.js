const bcrypt = require("bcrypt");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const { getEmailConfiguration, sendVerificationEmail } = require("../services/email.service");
const { getTokenVersion, tokenVersionFilter } = require("../services/session.service");

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN = "7d";
const EMAIL_VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_COOLDOWN_MS = 60 * 1000;
const EMAIL_VERIFICATION_FIELDS = [
  "emailVerificationTokenHash",
  "emailVerificationExpiresAt",
  "emailVerificationSentAt",
];

function createEmailVerification(now = new Date()) {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    fields: {
      emailVerificationTokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      emailVerificationExpiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_LIFETIME_MS),
      emailVerificationSentAt: now,
    },
  };
}

function verificationResponse(req, res, status, message) {
  const success = status === 200;
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  });

  if (req.accepts(["json", "html"]) === "html") {
    // Only fixed server messages are rendered here, never tokens or account data.
    const title = success ? "Email verified" : "Unable to verify email";
    return res.status(status).type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | GCC Talent</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7fb; color: #172033; font: 17px/1.6 system-ui, sans-serif; }
    main { margin: 24px; padding: 40px; max-width: 480px; border-radius: 20px; background: white; box-shadow: 0 12px 48px #17203312; }
    .brand { color: #5264ce; font-weight: 700; letter-spacing: .04em; }
    h1 { line-height: 1.2; font-size: 30px; }
    p { color: #526078; }
  </style>
</head>
<body><main>
  <div class="brand">GCC Talent</div>
  <h1>${title}</h1>
  <p>${message}</p>
  <p>You can close this page and return to GCC Talent.${success ? "" : " If you already verified your email, you can sign in; otherwise, sign in and request a new link."}</p>
</main></body>
</html>`);
  }

  return res.status(status).json({ success, message });
}

function createAccessToken(user) {
  return jwt.sign(
    {
      _id: user._id,
      role: user.role,
      tokenVersion: getTokenVersion(user),
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
      tokenVersion: getTokenVersion(user),
    },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    }
  );
}

async function signUp(req, res) {
  try {
    const { name, email, password, role } = req.body || {};

    // Validation
    if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.trim() || typeof password !== "string" || !password || !role) return res.status(400).json({ success: false, message: "name, email, password, and role are required.", });
    if (password.length < 8) return res.status(400).json({ success: false, message: "Password must be atleast 8 characters", });
    if (!["client", "freelancer"].includes(role)) return res.status(400).json({ success: false, message: "Role must be either client or freelancer.", })

    const normalizedEmail = email.toLowerCase().trim();
    if (normalizedEmail.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "A valid email address is required." });
    }
    const existingUser = await User.findOne({ email: normalizedEmail })

    if (existingUser) return res.status(409).json({ success: false, message: "An account with this email already exists.", });

    const configuration = getEmailConfiguration();
    const verification = createEmailVerification();
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      hashedPassword: password,
      role,
      ...verification.fields,
    });

    let verificationEmailSent = false;
    let deliveryUnconfirmed = false;
    try {
      await sendVerificationEmail({ user, token: verification.token, configuration });
      verificationEmailSent = true;
    } catch (err) {
      deliveryUnconfirmed = err.deliveryUnconfirmed !== false;
      // The account remains usable so the user can sign in and request another email.
      // Never log provider errors: they can contain the API key and verification URL.
      console.error("Sign-up verification email delivery failed.");
    }

    return res.status(201).json({
      success: true,
      message: verificationEmailSent
        ? "Account created. Check your email to verify your address."
        : deliveryUnconfirmed
          ? "Account created, but email delivery could not be confirmed. Check your inbox or sign in and request a new link after one minute."
          : "Account created, but the verification email could not be sent. Sign in and request a new link after one minute.",
      data: {
        verificationEmailSent,
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
    if (err.code === "EMAIL_CONFIGURATION_ERROR") {
      console.error("Email verification configuration is missing or invalid.");
      return res.status(503).json({ success: false, message: "Email verification is temporarily unavailable. Please try again later." });
    }

    if (err.name === "ValidationError") {
      return res.status(400).json({success: false, message: err.message,});
    }
    if (err.code === 11000) {
      return res.status(409).json({success: false, message: "An account with this email already exists.",});
    }

    console.error("Sign-up failed.");
    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

async function verifyEmail(req, res) {
  const token = req.query.token;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    return verificationResponse(req, res, 400, "A valid email verification link is required.");
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    // Consume and verify in one database operation, so a link can only succeed once.
    const user = await User.findOneAndUpdate(
      {
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: { $gt: new Date() },
        isEmailVerified: { $ne: true },
      },
      {
        $set: { isEmailVerified: true },
        $unset: Object.fromEntries(EMAIL_VERIFICATION_FIELDS.map((field) => [field, 1])),
      },
      { new: true },
    ).select("_id");

    if (!user) {
      return verificationResponse(req, res, 400, "This verification link is invalid, expired, or has already been used.");
    }

    return verificationResponse(req, res, 200, "Your email address has been verified successfully.");
  } catch (_) {
    console.error("Email verification failed.");
    return verificationResponse(req, res, 500, "We could not verify your email right now. Please try again later.");
  }
}

async function resendVerification(req, res) {
  try {
    const user = await User.findById(req.user._id).select(
      EMAIL_VERIFICATION_FIELDS.map((field) => `+${field}`).join(" "),
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (user.status === "suspended") {
      return res.status(403).json({ success: false, message: "This account has been suspended." });
    }
    if (user.isEmailVerified) {
      return res.status(200).json({ success: true, message: "Your email address is already verified." });
    }

    const now = new Date();
    const retryAfterSeconds = user.emailVerificationSentAt
      ? Math.ceil((user.emailVerificationSentAt.getTime() + EMAIL_VERIFICATION_COOLDOWN_MS - now.getTime()) / 1000)
      : 0;
    if (retryAfterSeconds > 0) {
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ success: false, message: "Please wait before requesting another verification email.", retryAfterSeconds });
    }

    const configuration = getEmailConfiguration();
    const verification = createEmailVerification(now);
    // Claim the send atomically; concurrent requests must not rotate each other's links.
    const previous = await User.findOneAndUpdate(
      {
        _id: user._id,
        email: user.email,
        isEmailVerified: { $ne: true },
        status: { $ne: "suspended" },
        $or: [
          { emailVerificationSentAt: { $lte: new Date(now.getTime() - EMAIL_VERIFICATION_COOLDOWN_MS) } },
          { emailVerificationSentAt: null },
        ],
      },
      { $set: verification.fields },
      { returnDocument: "before" },
    ).select(EMAIL_VERIFICATION_FIELDS.map((field) => `+${field}`).join(" "));

    if (!previous) {
      res.set("Retry-After", "60");
      return res.status(429).json({ success: false, message: "Please wait before requesting another verification email.", retryAfterSeconds: 60 });
    }

    try {
      await sendVerificationEmail({ user: previous, token: verification.token, configuration });
    } catch (err) {
      // A timeout may occur after Resend accepted the email. Keep that link usable.
      if (err.deliveryUnconfirmed !== false) {
        console.error("Verification email delivery status could not be confirmed.");
        res.set("Retry-After", "60");
        return res.status(503).json({ success: false, message: "Email delivery could not be confirmed. Check your inbox or request another link after one minute." });
      }

      const restore = { $set: {}, $unset: {} };
      for (const field of EMAIL_VERIFICATION_FIELDS) {
        if (previous[field] === undefined) restore.$unset[field] = 1;
        else restore.$set[field] = previous[field];
      }
      if (!Object.keys(restore.$set).length) delete restore.$set;
      if (!Object.keys(restore.$unset).length) delete restore.$unset;

      // Keep the previous link on failure, without overwriting a newer send or verification.
      await User.updateOne(
        { _id: previous._id, emailVerificationTokenHash: verification.fields.emailVerificationTokenHash, isEmailVerified: { $ne: true } },
        restore,
      );
      console.error("Verification email delivery failed.");
      return res.status(503).json({ success: false, message: "The verification email could not be sent. Please try again later." });
    }

    return res.status(200).json({ success: true, message: "Verification email sent. Please check your inbox." });
  } catch (err) {
    if (err.code === "EMAIL_CONFIGURATION_ERROR") {
      console.error("Email verification configuration is missing or invalid.");
      return res.status(503).json({ success: false, message: "Email verification is temporarily unavailable. Please try again later." });
    }
    console.error("Unable to resend verification email.");
    return res.status(500).json({ success: false, message: "Internal Server Error" });
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
      .select("+hashedPassword +refreshTokenHash +tokenVersion");

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

    const session = await User.updateOne(
      { _id: user._id, hashedPassword: user.hashedPassword, status: { $ne: "suspended" }, ...tokenVersionFilter(user) },
      { $set: { refreshTokenHash: await bcrypt.hash(refreshToken, 12), lastLoginAt: new Date() } },
    );
    if (!session.matchedCount) {
      return res.status(401).json({ success: false, message: "Your credentials changed. Please sign in again." });
    }

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
      "+refreshTokenHash +tokenVersion"
    );

    if (!user || !user.refreshTokenHash || getTokenVersion(user) !== getTokenVersion(decoded)) {
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

    const session = await User.updateOne(
      { _id: user._id, refreshTokenHash: user.refreshTokenHash, status: { $ne: "suspended" }, ...tokenVersionFilter(user) },
      { $set: { refreshTokenHash: await bcrypt.hash(newRefreshToken, 12) } },
    );
    if (!session.matchedCount) {
      return res.status(401).json({ success: false, message: "Invalid refresh token. Please sign in again." });
    }

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
  verifyEmail,
  resendVerification,
  signIn,
  refresh,
  logout,
  getCurrentUser,
};
