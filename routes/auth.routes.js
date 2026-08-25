const router = require("express").Router();
const verifyToken = require("../middleware/verifyToken");
const authController = require('../controllers/auth.controller')

router.post("/register", authController.signUp );

router.post("/login",  authController.signIn);

router.post("/refresh", authController.refresh);

router.post("/logout", verifyToken, authController.logout);

router.get("/me", verifyToken, authController.getCurrentUser);

module.exports = router;
