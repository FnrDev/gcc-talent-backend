const mongoose = require("mongoose");

const Transaction = require("../models/Transaction");

const TRANSACTION_TYPES = [
  "deposit",
  "escrow_fund",
  "escrow_release",
  "escrow_refund",
  "platform_fee",
  "withdrawal",
];
const TRANSACTION_DIRECTIONS = ["credit", "debit"];
const TRANSACTION_STATUSES = ["completed", "failed"];

function validateObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function getTransactions(req, res) {
  try {
    const { type, direction, status, contract, from, to, page = 1, limit = 20 } = req.query;

    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);
    const currentPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const currentLimit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;

    const filter = { user: req.user._id };

    if (type !== undefined) {
      if (!TRANSACTION_TYPES.includes(type)) {
        return res.status(400).json({success: false, message: "Invalid transaction type.",});
      }
      filter.type = type;
    }

    if (direction !== undefined) {
      if (!TRANSACTION_DIRECTIONS.includes(direction)) {
        return res.status(400).json({success: false, message: "Direction must be credit or debit.",});
      }
      filter.direction = direction;
    }

    if (status !== undefined) {
      if (!TRANSACTION_STATUSES.includes(status)) {
        return res.status(400).json({success: false, message: "Status must be completed or failed.",});
      }
      filter.status = status;
    }

    if (contract !== undefined) {
      if (!validateObjectId(contract)) {
        return res.status(400).json({success: false, message: "Invalid contract id.",});
      }
      filter.contract = contract;
    }

    if (from !== undefined || to !== undefined) {
      filter.createdAt = {};

      if (from !== undefined) {
        const fromDate = new Date(from);

        if (Number.isNaN(fromDate.getTime())) {
          return res.status(400).json({success: false, message: "Invalid from date.",});
        }
        filter.createdAt.$gte = fromDate;
      }

      if (to !== undefined) {
        const toDate = new Date(to);

        if (Number.isNaN(toDate.getTime())) {
          return res.status(400).json({success: false, message: "Invalid to date.",});
        }
        filter.createdAt.$lte = toDate;
      }
    }

    const skip = (currentPage - 1) * currentLimit;

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate("contract", "title totalAmount currency status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(currentLimit)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        transactions,
        pagination: {
          page: currentPage,
          limit: currentLimit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / currentLimit),
        },
      },
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

async function getTransactionSummary(req, res) {
  try {
    const rows = await Transaction.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(req.user._id), status: "completed" } },
      {
        $group: {
          _id: { type: "$type", direction: "$direction" },
          amount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const summary = {
      totalCredited: 0,
      totalDebited: 0,
      count: 0,
      byType: {},
    };

    for (const row of rows) {
      const { type, direction } = row._id;

      if (direction === "credit") {
        summary.totalCredited += row.amount;
      } else {
        summary.totalDebited += row.amount;
      }

      summary.count += row.count;
      summary.byType[type] = { amount: row.amount, count: row.count, direction };
    }

    summary.totalCredited = Math.round(summary.totalCredited * 100) / 100;
    summary.totalDebited = Math.round(summary.totalDebited * 100) / 100;
    summary.net = Math.round((summary.totalCredited - summary.totalDebited) * 100) / 100;

    return res.status(200).json({ success: true, data: { summary } });

  } catch (err) {
    console.error(err);

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

async function getTransaction(req, res) {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findOne({ _id: id, user: req.user._id })
      .populate("contract", "title totalAmount currency status")
      .lean();

    if (!transaction) {
      return res.status(404).json({success: false, message: "Transaction not found.",});
    }

    return res.status(200).json({ success: true, data: { transaction } });

  } catch (err) {
    console.error(err);

    return res.status(500).json({success: false, message: "Internal Server Error",});
  }
}

module.exports = {
  getTransactions,
  getTransactionSummary,
  getTransaction,
};
