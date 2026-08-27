const router = require("express").Router();

const jobController = require("../controllers/job.controller");
const proposalController = require("../controllers/proposal.controller")
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


// Proposal routes connected to jobs

router.post("/:id/proposals", verifyToken, validateObjectId, proposalController.submitProposal);

router.get("/:id/proposals", verifyToken, validateObjectId, proposalController.getJobProposals);



router.get("/:id", validateObjectId, jobController.getJob);

module.exports = router;