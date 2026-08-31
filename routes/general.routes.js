const router = require("express").Router();

const generalController = require("../controllers/general.controller");

router.get("/home", generalController.getHome);
router.get("/search", generalController.searchMarketplace);

module.exports = router;
