const rateLimit = require("express-rate-limit");

const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes

  max: 100, // Limit each IP to 100 requests per window

  standardHeaders: true,

  legacyHeaders: false,

  message: {
    message: "Too many requests. Please try again later.",
  },
});
 
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many Login attempts. Please try again later.",
  },
});

// Count successful sends too, so account creation cannot bypass email abuse limits.
const verificationEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification email requests. Please try again later.",
  },
});

const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many password reset requests. Please try again later." },
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many password reset attempts. Please try again later." },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => String(req.user._id),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attachment uploads. Please try again later." },
});


module.exports = {
  authLimiter,
  standardLimiter,
  verificationEmailLimiter,
  passwordResetRequestLimiter,
  passwordResetLimiter,
  uploadLimiter,
}
