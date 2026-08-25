const router = require("express").Router();

const verifyToken = require("../middleware/verifyToken");
const profileController = require("../controllers/profile.controller");

router.get("/me", verifyToken, profileController.getMyProfile);

router.patch("/me", verifyToken, profileController.updateMyProfile);

router.get("/:userId", profileController.getPublicProfile);

module.exports = router;