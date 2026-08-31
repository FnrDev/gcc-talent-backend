const router = require("express").Router();

const verifyToken = require("../middleware/verifyToken");
const profileController = require("../controllers/profile.controller");

router.get("/me", verifyToken, profileController.getMyProfile);

router.patch("/me", verifyToken, profileController.updateMyProfile);

router.post("/me/portfolio", verifyToken, profileController.createPortfolioItem);

router.patch("/me/portfolio/:itemId", verifyToken, profileController.updatePortfolioItem);

router.delete("/me/portfolio/:itemId", verifyToken, profileController.deletePortfolioItem);

router.get("/:userId", profileController.getPublicProfile);

module.exports = router;
