const router = require("express").Router();

const proposalController = require("../controllers/proposal.controller");

const verifyToken = require("../middleware/verifyToken");

const validateObjectId = require("../middleware/validateObjectId");


// All proposal routes require authentication

router.get("/mine", verifyToken, proposalController.getMyProposals);

router.patch("/:id", verifyToken, validateObjectId, proposalController.updateProposal);

router.post("/:id/withdraw", verifyToken, validateObjectId, proposalController.withdrawProposal);

router.patch("/:id/status", verifyToken, validateObjectId, proposalController.updateProposalStatus);

router.post("/:id/accept", verifyToken, validateObjectId, proposalController.acceptProposal);

module.exports = router;