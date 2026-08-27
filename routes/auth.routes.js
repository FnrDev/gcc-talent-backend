const router = require("express").Router();
const verifyToken = require("../middleware/verifyToken");
const authController = require('../controllers/auth.controller')
const { verificationEmailLimiter } = require("../middleware/rateLimiters");

router.post("/register", verificationEmailLimiter, authController.signUp );

// Express otherwise routes HEAD through GET, which would consume a verification link.
router.head("/verify-email", (_req, res) => res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).status(204).end());
router.get("/verify-email", authController.verifyEmail);

router.post("/resend-verification", verifyToken, verificationEmailLimiter, authController.resendVerification);

router.post("/login",  authController.signIn);

router.post("/refresh", authController.refresh);

router.post("/logout", verifyToken, authController.logout);

router.get("/me", verifyToken, authController.getCurrentUser);

module.exports = router;
