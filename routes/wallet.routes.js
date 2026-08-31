const router = require("express").Router();

const verifyToken = require("../middleware/verifyToken");
const validateObjectId = require("../middleware/validateObjectId");
const walletController = require("../controllers/wallet.controller");
const transactionController = require("../controllers/transaction.controller");

router.use(verifyToken);

router.get("/", walletController.getWallet);

router.post("/deposits", walletController.addFunds);
router.post("/withdrawals", walletController.withdrawFunds);

// Backwards-compatible aliases. They now share the canonical idempotency and
// validation contract, including the required Idempotency-Key header.
router.post("/deposit", walletController.addFunds);
router.post("/withdraw", walletController.withdrawFunds);

router.get("/transactions", transactionController.getTransactions);
router.get("/transactions/summary", transactionController.getTransactionSummary);
router.get("/transactions/:id/receipt", validateObjectId, transactionController.getTransactionReceipt);
router.get("/transactions/:id", validateObjectId, transactionController.getTransaction);

module.exports = router;
