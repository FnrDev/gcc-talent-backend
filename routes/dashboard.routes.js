const router = require("express").Router();

const dashboardController = require("../controllers/dashboard.controller");
const verifyToken = require("../middleware/verifyToken");

router.get("/", verifyToken, dashboardController.getDashboard);

module.exports = router;
