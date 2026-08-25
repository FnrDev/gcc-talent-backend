const router = require("express").Router();
const skillController = require("../controllers/skill.controller");
const validateObjectId = require("../middleware/validateObjectId");

router.get("/", skillController.getSkills);
router.get("/:id", validateObjectId, skillController.getSkill);

module.exports = router;
