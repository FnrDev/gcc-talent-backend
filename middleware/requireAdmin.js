const User = require("../models/User");

async function requireAdmin(req, res, next) {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Authentication required." });
    }

    // Resolve the role from the database rather than trusting a possibly stale
    // role claim in a long-lived access token.
    const user = await User.findById(req.user._id).select("role status");

    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    if (user.status === "suspended") {
      return res.status(403).json({ message: "This account is suspended." });
    }

    if (user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required." });
    }

    req.admin = user;
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
}

module.exports = requireAdmin;
