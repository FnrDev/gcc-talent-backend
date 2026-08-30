const router = require("express").Router();
const serviceController = require("../controllers/service.controller");
const verifyToken = require("../middleware/verifyToken");

router.post("/", verifyToken, serviceController.createService);

module.exports = router;
