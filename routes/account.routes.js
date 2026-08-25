const router = require("express").Router();

const verifyToken = require("../middleware/verifyToken");
const accountController = require("../controllers/account.controller");

router.patch("/me", verifyToken,accountController.updateAccount);

router.patch("/me/password", verifyToken, accountController.changePassword);

router.patch("/me/preferences", verifyToken, accountController.updatePreferences);

module.exports = router;