const router = require("express").Router();
const adminController = require("../controllers/admin.controller");
const skillController = require("../controllers/skill.controller");
const verifyToken = require("../middleware/verifyToken");
const requireAdmin = require("../middleware/requireAdmin");
const validateObjectId = require("../middleware/validateObjectId");

router.use(verifyToken, requireAdmin);

router.get("/stats", adminController.getStatistics);

router.get("/users", adminController.getUsers);
router.get("/users/:id", validateObjectId, adminController.getUser);
router.patch("/users/:id", validateObjectId, adminController.updateUser);
router.delete("/users/:id", validateObjectId, adminController.deleteUser);

router.get("/categories", adminController.getCategories);
router.post("/categories", adminController.createCategory);
router.get("/categories/:id", validateObjectId, adminController.getCategory);
router.patch("/categories/:id", validateObjectId, adminController.updateCategory);
router.delete("/categories/:id", validateObjectId, adminController.deleteCategory);

router.get("/skills", skillController.getSkills);
router.post("/skills", skillController.createSkill);
router.get("/skills/:id", validateObjectId, skillController.getSkill);
router.patch("/skills/:id", validateObjectId, skillController.updateSkill);
router.delete("/skills/:id", validateObjectId, skillController.deleteSkill);

module.exports = router;
