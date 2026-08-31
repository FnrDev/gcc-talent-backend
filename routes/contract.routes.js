const router = require("express").Router();

const contractController = require("../controllers/contract.controller");
const messageController = require("../controllers/message.controller");

const verifyToken = require("../middleware/verifyToken");

const validateObjectId = require("../middleware/validateObjectId");


// All contract routes require authentication

router.use(verifyToken);

// Contract routes

router.get("/", contractController.getContracts);

router.get("/:id/workspace", validateObjectId, contractController.getContract);

router.get("/:id/activity", validateObjectId, contractController.getContractActivity);

router.get("/:id/messages", validateObjectId, messageController.getContractMessages);

router.post("/:id/messages", validateObjectId, messageController.createContractMessage);

router.get("/:id", validateObjectId, contractController.getContract);

router.post("/:id/milestones", validateObjectId, contractController.addMilestone);

router.patch("/:id/milestones/:mid", validateObjectId, contractController.updateMilestone);

router.post("/:id/milestones/:mid/fund", validateObjectId, contractController.fundMilestone);

router.post("/:id/milestones/:mid/start", validateObjectId, contractController.startMilestone);

router.post("/:id/milestones/:mid/deliver", validateObjectId, contractController.deliverMilestone);

router.post("/:id/milestones/:mid/deliveries", validateObjectId, contractController.deliverMilestone);

router.post("/:id/milestones/:mid/request-revision", validateObjectId, contractController.requestRevision);

router.post("/:id/milestones/:mid/approve", validateObjectId, contractController.approveMilestone);

router.post("/:id/cancel", validateObjectId, contractController.cancelContract);


module.exports = router;
