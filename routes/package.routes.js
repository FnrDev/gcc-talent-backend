const router = require("express").Router();

const packageController = require("../controllers/package.controller");

const verifyToken = require("../middleware/verifyToken");

const validateObjectId = require("../middleware/validateObjectId");


// Freelancer package management

router.get("/mine", verifyToken, packageController.getMyPackages);

router.post("/", verifyToken, packageController.createPackage);

router.patch("/:id", verifyToken, validateObjectId, packageController.updatePackage);

router.delete("/:id", verifyToken, validateObjectId, packageController.deletePackage);


// Public package

router.get("/:id", validateObjectId, packageController.getPackage);


module.exports = router;