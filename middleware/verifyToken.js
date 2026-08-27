const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const { getTokenVersion } = require("../services/session.service");

async function verifyToken(req, res, next) {
  let decoded;
  try {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || "");
    if (!match) throw new Error("Missing access token");
    decoded = jwt.verify(match[1], process.env.JWT_SECRET);
    if (!decoded || typeof decoded !== "object" || !mongoose.isValidObjectId(decoded._id)) {
      throw new Error("Invalid access token");
    }
    if (!Number.isSafeInteger(getTokenVersion(decoded)) || getTokenVersion(decoded) < 0) {
      throw new Error("Invalid session version");
    }
  } catch (_) {
    return res.status(401).json({ err: "Invalid token." });
  }

  try {
    const user = await User.findById(decoded._id).select("status +tokenVersion");
    if (!user || getTokenVersion(user) !== getTokenVersion(decoded)) {
      return res.status(401).json({ err: "Your session has expired. Please sign in again." });
    }
    if (user.status === "suspended") {
      return res.status(403).json({ err: "This account has been suspended." });
    }
    req.user = decoded;
    return next();
  } catch (_) {
    return res.status(503).json({ err: "Authentication is temporarily unavailable. Please try again later." });
  }
}

module.exports = verifyToken;
