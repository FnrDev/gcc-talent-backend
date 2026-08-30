const router = require("express").Router();
const serviceController = require("../controllers/service.controller");
const serviceOrderController = require("../controllers/serviceOrder.controller");
const { serviceOrderLimiter } = require("../middleware/rateLimiters");
const verifyToken = require("../middleware/verifyToken");
const validateObjectId = require("../middleware/validateObjectId");

router.get("/", serviceController.getServices);
router.post("/", verifyToken, serviceController.createService);
router.post(
  "/:id/orders",
  verifyToken,
  serviceOrderLimiter,
  validateObjectId,
  serviceOrderController.createServiceOrder,
);
router.get("/:id/similar", validateObjectId, serviceController.getSimilarServices);
router.get("/:id", validateObjectId, serviceController.getService);

module.exports = router;
