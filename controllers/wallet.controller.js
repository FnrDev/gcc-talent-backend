const crypto = require("node:crypto");
const mongoose = require("mongoose");

const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { recordAuditLogs } = require("../services/audit.service");

const PLATFORM_CURRENCY = "BHD";
const MAX_WALLET_AMOUNT = 100000;
const SUCCESS_TEST_CARD = "4242424242424242";
const DECLINED_TEST_CARD = "4000000000000002";

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 1000) / 1000;
}

function parseAmount(rawAmount) {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_WALLET_AMOUNT) return null;
  return roundMoney(amount);
}

function getIdempotencyKey(req) {
  const value = req.get("Idempotency-Key");
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200) return null;
  return value.trim();
}

function operationReference(userId, operation, key) {
  const keyHash = crypto
    .createHash("sha256")
    .update(`${operation}:${userId}:${key}`)
    .digest("hex");
  return `wallet:${operation}:${keyHash}`;
}

function hashRequest(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function publicTransaction(transaction) {
  const value = typeof transaction.toObject === "function" ? transaction.toObject() : { ...transaction };
  delete value.requestHash;
  return value;
}

function walletData(user) {
  const available = roundMoney(user.wallet?.available || 0);
  const pending = roundMoney(user.wallet?.pending || 0);
  return { available, pending, total: roundMoney(available + pending), currency: PLATFORM_CURRENCY };
}

function normalizeCard(rawBody) {
  const input = rawBody.card || rawBody.payment || rawBody;
  const cardNumber = String(input.cardNumber || "").replace(/\D/g, "");
  const cardholderName = typeof input.cardholderName === "string" ? input.cardholderName.trim() : "";
  const expiryMonth = Number(input.expiryMonth);
  let expiryYear = Number(input.expiryYear);
  const cvc = String(input.cvc || "").trim();

  if (!cardholderName || cardholderName.length > 120) return { error: "Cardholder name is required." };
  if (![SUCCESS_TEST_CARD, DECLINED_TEST_CARD].includes(cardNumber)) {
    return { error: "Use a supported mock card number. Real card details are not accepted." };
  }
  if (!Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12) {
    return { error: "Expiry month must be between 1 and 12." };
  }

  if (expiryYear >= 0 && expiryYear < 100) expiryYear += 2000;
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();
  if (!Number.isInteger(expiryYear) || expiryYear < currentYear || (expiryYear === currentYear && expiryMonth < currentMonth)) {
    return { error: "Card expiry must be in the future." };
  }
  if (!/^\d{3,4}$/.test(cvc)) return { error: "CVC must contain 3 or 4 digits." };

  return {
    card: { cardNumber, cardholderName, expiryMonth, expiryYear },
    declined: cardNumber === DECLINED_TEST_CARD,
  };
}

async function supportsAtomicWalletMutations() {
  if (!mongoose.connection.db) return false;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(hello.setName || hello.msg === "isdbgrid");
  } catch {
    return false;
  }
}

function atomicityUnavailable(res) {
  return res.status(503).json({
    success: false,
    code: "WALLET_ATOMICITY_UNAVAILABLE",
    message: "Wallet mutations require MongoDB replica-set transaction support. No balance or transaction was changed.",
  });
}

async function replayTransaction(req, res, { reference, requestHash, successMessage }) {
  const existing = await Transaction.findOne({ reference }).select("+requestHash");
  if (!existing) return false;

  if (existing.requestHash !== requestHash) {
    res.status(409).json({ success: false, message: "This Idempotency-Key was already used with a different request." });
    return true;
  }

  const user = await User.findById(req.user._id).select("wallet").lean();
  if (!user) {
    res.status(404).json({ success: false, message: "User not found." });
    return true;
  }

  if (existing.status === "failed") {
    res.status(402).json({
      success: false,
      replayed: true,
      message: "The mock card was declined.",
      data: { wallet: walletData(user), transaction: publicTransaction(existing) },
    });
    return true;
  }

  res.status(200).json({
    success: true,
    replayed: true,
    message: successMessage,
    data: { wallet: walletData(user), transaction: publicTransaction(existing) },
  });
  return true;
}

async function getWallet(req, res) {
  try {
    const user = await User.findById(req.user._id).select("wallet").lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    return res.status(200).json({ success: true, data: { wallet: walletData(user) } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function addFunds(req, res) {
  const amount = parseAmount(req.body.amount);
  if (amount === null) {
    return res.status(400).json({ success: false, message: `Amount must be between 0 and ${MAX_WALLET_AMOUNT} ${PLATFORM_CURRENCY}.` });
  }

  const key = getIdempotencyKey(req);
  if (!key) return res.status(400).json({ success: false, message: "Idempotency-Key header is required." });

  const cardResult = normalizeCard(req.body);
  if (cardResult.error) return res.status(400).json({ success: false, message: cardResult.error });

  const reference = operationReference(req.user._id, "deposit", key);
  const requestHash = hashRequest({ amount, currency: PLATFORM_CURRENCY, ...cardResult.card });

  try {
    if (await replayTransaction(req, res, { reference, requestHash, successMessage: "Funds added successfully." })) return undefined;
    if (!await supportsAtomicWalletMutations()) return atomicityUnavailable(res);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const existing = await Transaction.findOne({ reference }).select("+requestHash").session(session);
    if (existing) {
      await session.abortTransaction();
      return replayTransaction(req, res, { reference, requestHash, successMessage: "Funds added successfully." });
    }

    const user = await User.findById(req.user._id).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (user.status === "suspended") {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: "Suspended accounts cannot add funds." });
    }

    const [transaction] = await Transaction.create([{
      user: user._id,
      type: "deposit",
      amount,
      currency: PLATFORM_CURRENCY,
      direction: "credit",
      status: cardResult.declined ? "failed" : "completed",
      reference,
      requestHash,
      ...(cardResult.declined ? { failureCode: "mock_card_declined" } : {}),
    }], { session });

    if (!cardResult.declined) {
      user.wallet.available = roundMoney((user.wallet.available || 0) + amount);
      await user.save({ session });
    }

    await recordAuditLogs(req, [
      {
        action: "create",
        resource: "Transaction",
        resourceId: transaction._id,
        details: { operation: "addFunds", type: "deposit", amount, currency: PLATFORM_CURRENCY, direction: "credit", status: transaction.status },
      },
      ...(!cardResult.declined ? [{
        action: "update",
        resource: "User",
        resourceId: user._id,
        details: { operation: "addFunds", transactionId: transaction._id, changedFields: ["wallet.available"], availableBalanceDelta: amount },
      }] : []),
    ], { session });

    await session.commitTransaction();

    if (cardResult.declined) {
      return res.status(402).json({
        success: false,
        message: "The mock card was declined.",
        data: { wallet: walletData(user), transaction: publicTransaction(transaction) },
      });
    }

    return res.status(201).json({
      success: true,
      message: "Funds added successfully.",
      data: { wallet: walletData(user), transaction: publicTransaction(transaction) },
    });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err?.code === 11000 && await replayTransaction(req, res, { reference, requestHash, successMessage: "Funds added successfully." })) return undefined;
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  } finally {
    await session.endSession();
  }
}

async function withdrawFunds(req, res) {
  if (req.user.role !== "freelancer") {
    return res.status(403).json({ success: false, message: "Only freelancers can withdraw funds." });
  }

  const amount = parseAmount(req.body.amount);
  if (amount === null) {
    return res.status(400).json({ success: false, message: `Amount must be between 0 and ${MAX_WALLET_AMOUNT} ${PLATFORM_CURRENCY}.` });
  }

  const key = getIdempotencyKey(req);
  if (!key) return res.status(400).json({ success: false, message: "Idempotency-Key header is required." });

  const reference = operationReference(req.user._id, "withdrawal", key);
  const requestHash = hashRequest({ amount, currency: PLATFORM_CURRENCY });

  try {
    if (await replayTransaction(req, res, { reference, requestHash, successMessage: "Withdrawal completed successfully." })) return undefined;
    if (!await supportsAtomicWalletMutations()) return atomicityUnavailable(res);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const user = await User.findById(req.user._id).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (user.role !== "freelancer") {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: "Only freelancers can withdraw funds." });
    }
    if (user.status === "suspended") {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: "Suspended accounts cannot withdraw funds." });
    }
    if ((user.wallet.available || 0) < amount) {
      await session.abortTransaction();
      return res.status(422).json({ success: false, message: "Insufficient available balance." });
    }

    const existing = await Transaction.findOne({ reference }).select("+requestHash").session(session);
    if (existing) {
      await session.abortTransaction();
      return replayTransaction(req, res, { reference, requestHash, successMessage: "Withdrawal completed successfully." });
    }

    user.wallet.available = roundMoney(user.wallet.available - amount);
    await user.save({ session });

    const [transaction] = await Transaction.create([{
      user: user._id,
      type: "withdrawal",
      amount,
      currency: PLATFORM_CURRENCY,
      direction: "debit",
      status: "completed",
      reference,
      requestHash,
    }], { session });

    await recordAuditLogs(req, [
      {
        action: "create",
        resource: "Transaction",
        resourceId: transaction._id,
        details: { operation: "withdrawFunds", type: "withdrawal", amount, currency: PLATFORM_CURRENCY, direction: "debit", status: "completed" },
      },
      {
        action: "update",
        resource: "User",
        resourceId: user._id,
        details: { operation: "withdrawFunds", transactionId: transaction._id, changedFields: ["wallet.available"], availableBalanceDelta: -amount },
      },
    ], { session });

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: "Withdrawal completed successfully.",
      data: { wallet: walletData(user), transaction: publicTransaction(transaction) },
    });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err?.code === 11000 && await replayTransaction(req, res, { reference, requestHash, successMessage: "Withdrawal completed successfully." })) return undefined;
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  } finally {
    await session.endSession();
  }
}

module.exports = {
  getWallet,
  addFunds,
  withdrawFunds,
  AddToWallet: addFunds,
  RemoveFromWallet: withdrawFunds,
};
