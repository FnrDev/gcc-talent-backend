const crypto = require("crypto");

const User = require("../models/User");
const Transaction = require("../models/Transaction");

function parseAmount(rawAmount) {
  const amount = Number(rawAmount);

  if (!Number.isFinite(amount) || amount <= 0) return null;

  return Math.round(amount * 100) / 100;
}

function parseReference(rawReference) {
  if (rawReference === undefined || rawReference === null) {
    return crypto.randomUUID();
  }

  if (typeof rawReference !== "string" || !rawReference.trim()) return null;

  return rawReference.trim();
}

function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || err.code === 11001);
}

async function getWallet(req, res) {
  try {
    const user = await User.findById(req.user._id).select("wallet").lean();

    if (!user) {
      return res.status(404).json({success: false, message: "User not found.",});
    }

    return res.status(200).json({
      success: true,
      data: {
        wallet: {
          available: user.wallet.available,
          pending: user.wallet.pending,
          total: Math.round((user.wallet.available + user.wallet.pending) * 100) / 100,
        },
      },
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

async function AddToWallet(req, res) {
  try {
    const amount = parseAmount(req.body.amount);

    if (amount === null) {
      return res.status(400).json({success: false, message: "Amount must be a positive number.",});
    }

    const reference = parseReference(req.body.reference);

    if (reference === null) {
      return res.status(400).json({success: false, message: "Reference must be a non-empty string.",});
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({success: false, message: "User not found.",});
    }

    let transaction;

    try {
      transaction = await Transaction.create({
        user: user._id,
        type: "deposit",
        amount,
        direction: "credit",
        status: "completed",
        reference,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return res.status(409).json({success: false, message: "A transaction with this reference already exists.",});
      }

      throw err;
    }

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $inc: { "wallet.available": amount } },
      { new: true }
    );

    if (!updatedUser) {
      await Transaction.findByIdAndUpdate(transaction._id, { status: "failed" });

      return res.status(404).json({success: false, message: "User not found.",});
    }

    return res.status(201).json({
      success: true,
      data: {
        wallet: {
          available: updatedUser.wallet.available,
          pending: updatedUser.wallet.pending,
        },
        transaction,
      },
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

async function RemoveFromWallet(req, res) {
  try {
    const amount = parseAmount(req.body.amount);

    if (amount === null) {
      return res.status(400).json({success: false, message: "Amount must be a positive number.",});
    }

    const reference = parseReference(req.body.reference);

    if (reference === null) {
      return res.status(400).json({success: false, message: "Reference must be a non-empty string.",});
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({success: false, message: "User not found.",});
    }

    if (user.wallet.available < amount) {
      return res.status(400).json({success: false, message: "Insufficient available balance.",});
    }

    let transaction;

    try {
      transaction = await Transaction.create({
        user: user._id,
        type: "withdrawal",
        amount,
        direction: "debit",
        status: "completed",
        reference,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return res.status(409).json({success: false, message: "A transaction with this reference already exists.",});
      }

      throw err;
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: user._id, "wallet.available": { $gte: amount } },
      { $inc: { "wallet.available": -amount } },
      { new: true }
    );

    if (!updatedUser) {
      await Transaction.findByIdAndUpdate(transaction._id, { status: "failed" });

      return res.status(400).json({success: false, message: "Insufficient available balance.",});
    }

    return res.status(201).json({
      success: true,
      data: {
        wallet: {
          available: updatedUser.wallet.available,
          pending: updatedUser.wallet.pending,
        },
        transaction,
      },
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

module.exports = {
  getWallet,
  AddToWallet,
  RemoveFromWallet,
};
