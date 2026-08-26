const router = require("express").Router();

const jobController = require("../controllers/job.controller");
const verifyToken = require("../middleware/verifyToken");
const validateObjectId = require("../middleware/validateObjectId");


// Public routes
router.get("/", jobController.getJobs);


// Authenticated client routes

router.get("/my/list", verifyToken, jobController.getMyJobs);

router.get("/my/:id", verifyToken,  validateObjectId, jobController.getMyJob);

router.post("/", verifyToken,  jobController.createJob);

router.patch("/my/:id", verifyToken,  validateObjectId, jobController.updateMyJob);

router.post("/my/:id/publish", verifyToken,  validateObjectId, jobController.publishJob);

router.post("/my/:id/close", verifyToken,  validateObjectId, jobController.closeJob);

router.post("/my/:id/reopen", verifyToken,  validateObjectId, jobController.reopenJob);

router.delete("/my/:id", verifyToken,  validateObjectId, jobController.deleteMyJob);

router.get("/:id", validateObjectId, jobController.getJob);

module.exports = router;