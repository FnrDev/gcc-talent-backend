const router = require("express").Router();

const categoryController = require("../controllers/category.controller");
const validateObjectId = require("../middleware/validateObjectId");

// Public reads — categories feed the job search filters, the job form and the
// landing page, so they are readable by guests (spec section 09).
router.get("/", categoryController.getCategories);

router.get("/slug/:slug", categoryController.getCategoryBySlug);

router.get("/:id", validateObjectId, categoryController.getCategory);

module.exports = router;
