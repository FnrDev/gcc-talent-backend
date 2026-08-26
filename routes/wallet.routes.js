const router = require("express").Router();

const verifyToken = require("../middleware/verifyToken");
const validateObjectId = require("../middleware/validateObjectId");
const walletController = require("../controllers/wallet.controller");
const transactionController = require("../controllers/transaction.controller");

router.use(verifyToken);

router.get("/", walletController.getWallet);

router.post("/deposit", walletController.AddToWallet);
router.post("/withdraw", walletController.RemoveFromWallet);

router.get("/transactions", transactionController.getTransactions);
router.get("/transactions/summary", transactionController.getTransactionSummary);
router.get("/transactions/:id", validateObjectId, transactionController.getTransaction);

module.exports = router;
