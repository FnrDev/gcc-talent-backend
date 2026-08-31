const router = require("express").Router();

const verifyToken = require("../middleware/verifyToken");
const validateObjectId = require("../middleware/validateObjectId");
const transactionController = require("../controllers/transaction.controller");

router.use(verifyToken);

router.get("/", transactionController.getTransactions);
router.get("/summary", transactionController.getTransactionSummary);
router.get("/:id/receipt", validateObjectId, transactionController.getTransactionReceipt);
router.get("/:id", validateObjectId, transactionController.getTransaction);

module.exports = router;
