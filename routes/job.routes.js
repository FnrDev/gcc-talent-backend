const router = require("express").Router();

const jobController = require("../controllers/job.controller");
const verifyToken = require("../middleware/verifyToken");
const validateObjectId = require("../middleware/validateObjectId");


router.get("/", jobController.getJobs);

router.get("/:id", validateObjectId, jobController.getJob);


// Authenticated client routes

router.use(verifyToken);

router.get("/my/list", jobController.getMyJobs);

router.get("/my/:id", validateObjectId, jobController.getMyJob);

router.post("/", jobController.createJob);

router.patch("/my/:id", validateObjectId, jobController.updateMyJob);

router.post("/my/:id/publish", validateObjectId, jobController.publishJob);

router.post("/my/:id/close", validateObjectId, jobController.closeJob);

router.delete("/my/:id", validateObjectId, jobController.deleteMyJob);

module.exports = router;