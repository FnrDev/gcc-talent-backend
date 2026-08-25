const {
  User,
  Job,
  Contract,
  Transaction,
  Category,
  Skill,
} = require("../models");

const USER_ROLES = ["client", "freelancer", "admin"];
const USER_STATUSES = ["active", "suspended"];
const MAX_PAGE_SIZE = 100;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePagination(query) {
  const requestedPage = Number.parseInt(query.page, 10);
  const requestedLimit = Number.parseInt(query.limit, 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_PAGE_SIZE)
      : 20;

  return { page, limit, skip: (page - 1) * limit };
}

function paginationResult(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function countsToObject(rows, expectedKeys = []) {
  const counts = Object.fromEntries(expectedKeys.map((key) => [key, 0]));

  for (const row of rows) {
    if (row._id != null) counts[row._id] = row.count;
  }

  return counts;
}

function sumCounts(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function buildDailySeries(rows, startDate, days) {
  const counts = new Map(rows.map((row) => [row._id, row.count]));

  return Array.from({ length: days }, (_value, index) => {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { date: key, count: counts.get(key) || 0 };
  });
}

function buildFinancialSeries(rows, startDate, days) {
  const values = new Map(rows.map((row) => [row._id, row]));

  return Array.from({ length: days }, (_value, index) => {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    const point = values.get(key);
    return {
      date: key,
      gmv: point?.gmv || 0,
      platformRevenue: point?.platformRevenue || 0,
    };
  });
}

function handleError(res, err) {
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || "value";
    return res.status(409).json({ message: `A record with that ${field} already exists.` });
  }

  if (err?.name === "ValidationError") {
    return res.status(400).json({ message: err.message });
  }

  if (err?.name === "CastError") {
    return res.status(404).json({ message: "Resource not found." });
  }

  console.error(err);
  return res.status(500).json({ message: "Internal Server Error" });
}

async function getStatistics(_req, res) {
  try {
    const today = startOfUtcDay(new Date());
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setUTCDate(today.getUTCDate() - 29);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setUTCDate(today.getUTCDate() - 6);

    const [
      userRoleRows,
      userStatusRows,
      signupRows,
      jobRows,
      contractRows,
      transactionRows,
      financialRows,
    ] = await Promise.all([
        User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
        User.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        User.aggregate([
          { $match: { createdAt: { $gte: thirtyDaysAgo } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        Job.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        Contract.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        Transaction.aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              completed: {
                $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
              },
              failed: {
                $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
              },
              volume: {
                $sum: {
                  $cond: [{ $eq: ["$status", "completed"] }, "$amount", 0],
                },
              },
              platformRevenue: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$status", "completed"] },
                        { $eq: ["$type", "platform_fee"] },
                      ],
                    },
                    "$amount",
                    0,
                  ],
                },
              },
              gmv: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$status", "completed"] },
                        { $eq: ["$type", "escrow_release"] },
                      ],
                    },
                    "$amount",
                    0,
                  ],
                },
              },
            },
          },
        ]),
        Transaction.aggregate([
          {
            $match: {
              createdAt: { $gte: thirtyDaysAgo },
              status: "completed",
              type: { $in: ["escrow_release", "platform_fee"] },
            },
          },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              gmv: {
                $sum: { $cond: [{ $eq: ["$type", "escrow_release"] }, "$amount", 0] },
              },
              platformRevenue: {
                $sum: { $cond: [{ $eq: ["$type", "platform_fee"] }, "$amount", 0] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      ]);

    const usersByRole = countsToObject(userRoleRows, USER_ROLES);
    const usersByStatus = countsToObject(userStatusRows, USER_STATUSES);
    const jobsByStatus = countsToObject(jobRows, [
      "draft",
      "open",
      "in_progress",
      "completed",
      "closed",
    ]);
    const contractsByStatus = countsToObject(contractRows, [
      "active",
      "completed",
      "cancelled",
    ]);
    const transactionValues = transactionRows[0] || {};
    const transactionSummary = {
      total: transactionValues.total || 0,
      completed: transactionValues.completed || 0,
      failed: transactionValues.failed || 0,
      volume: transactionValues.volume || 0,
      platformRevenue: transactionValues.platformRevenue || 0,
      gmv: transactionValues.gmv || 0,
    };
    const signupSeries = buildDailySeries(signupRows, thirtyDaysAgo, 30);
    const last7Days = signupSeries
      .filter((point) => new Date(`${point.date}T00:00:00.000Z`) >= sevenDaysAgo)
      .reduce((sum, point) => sum + point.count, 0);
    const last30Days = signupSeries.reduce((sum, point) => sum + point.count, 0);

    return res.status(200).json({
      kpis: {
        totalUsers: sumCounts(usersByRole),
        usersByRole,
        usersByStatus,
        newSignups: {
          last7Days,
          last30Days,
        },
        openJobs: jobsByStatus.open,
        activeContracts: contractsByStatus.active,
        gmv: transactionSummary.gmv,
        platformRevenue: transactionSummary.platformRevenue,
      },
      timeSeries: {
        signups: signupSeries,
        financials: buildFinancialSeries(financialRows, thirtyDaysAgo, 30),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function getUsers(req, res) {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};

    if (req.query.role) {
      if (!USER_ROLES.includes(req.query.role)) {
        return res.status(400).json({ message: "Invalid role filter." });
      }
      filter.role = req.query.role;
    }

    if (req.query.status) {
      if (!USER_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ message: "Invalid status filter." });
      }
      filter.status = req.query.status;
    }

    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const search = new RegExp(escapeRegExp(req.query.search.trim()), "i");
      filter.$or = [{ name: search }, { email: search }];
    }

    const allowedSortFields = new Set(["name", "email", "role", "status", "createdAt"]);
    const requestedSort = typeof req.query.sort === "string" ? req.query.sort : "-createdAt";
    const sortField = requestedSort.replace(/^-/, "");
    const sort = allowedSortFields.has(sortField) ? requestedSort : "-createdAt";

    const [users, total] = await Promise.all([
      User.find(filter)
        .select(
          "name email role avatarUrl isEmailVerified status country city ratingAvg ratingCount wallet lastLoginAt createdAt updatedAt",
        )
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      users,
      pagination: paginationResult(page, limit, total),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function getUser(req, res) {
  try {
    const userPromise = User.findById(req.params.id)
      .select(
        "name email role avatarUrl isEmailVerified status country city ratingAvg ratingCount wallet notificationPrefs lastLoginAt createdAt updatedAt",
      )
      .lean();
    const contractsFilter = {
      $or: [{ client: req.params.id }, { freelancer: req.params.id }],
    };
    const [user, contracts, contractCount, transactions, transactionCount] = await Promise.all([
      userPromise,
      Contract.find(contractsFilter)
        .select("client freelancer source title totalAmount currency status startedAt completedAt createdAt")
        .populate("client freelancer", "name email role")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Contract.countDocuments(contractsFilter),
      Transaction.find({ user: req.params.id })
        .select("contract milestoneId type amount direction status reference createdAt")
        .populate("contract", "title status")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Transaction.countDocuments({ user: req.params.id }),
    ]);

    if (!user) return res.status(404).json({ message: "User not found." });
    return res.status(200).json({
      user,
      contracts: {
        items: contracts,
        total: contractCount,
        limitedTo: 20,
      },
      transactions: {
        items: transactions,
        total: transactionCount,
        limitedTo: 20,
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function updateUser(req, res) {
  try {
    const updates = {};

    if (Object.hasOwn(req.body, "status")) {
      if (!USER_STATUSES.includes(req.body.status)) {
        return res.status(400).json({ message: "Status must be active or suspended." });
      }
      updates.status = req.body.status;
    }

    if (Object.hasOwn(req.body, "isEmailVerified")) {
      if (typeof req.body.isEmailVerified !== "boolean") {
        return res.status(400).json({ message: "isEmailVerified must be a boolean." });
      }
      updates.isEmailVerified = req.body.isEmailVerified;
    }

    if (Object.hasOwn(req.body, "role")) {
      if (!USER_ROLES.includes(req.body.role)) {
        return res.status(400).json({ message: "Role must be client, freelancer, or admin." });
      }
      updates.role = req.body.role;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "Provide status, isEmailVerified, or role to update.",
      });
    }

    const isSelf = req.params.id === String(req.user._id);
    if (isSelf && updates.status === "suspended") {
      return res.status(400).json({ message: "You cannot suspend your own account." });
    }
    if (isSelf && updates.role && updates.role !== "admin") {
      return res.status(400).json({ message: "You cannot remove your own admin access." });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true },
    ).select(
      "name email role avatarUrl isEmailVerified status country city ratingAvg ratingCount lastLoginAt createdAt updatedAt",
    );

    if (!user) return res.status(404).json({ message: "User not found." });
    return res.status(200).json({ message: "User updated.", user });
  } catch (err) {
    return handleError(res, err);
  }
}

async function deleteUser(req, res) {
  try {
    if (req.params.id === String(req.user._id)) {
      return res.status(400).json({ message: "You cannot delete your own account." });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    const [jobsCount, contractsCount, transactionsCount] = await Promise.all([
      Job.countDocuments({ client: req.params.id }),
      Contract.countDocuments({
        $or: [{ client: req.params.id }, { freelancer: req.params.id }],
      }),
      Transaction.countDocuments({ user: req.params.id }),
    ]);

    if (jobsCount > 0 || contractsCount > 0 || transactionsCount > 0) {
      return res.status(409).json({
        message: "User has marketplace history and cannot be deleted. Suspend the account instead.",
        references: {
          jobs: jobsCount,
          contracts: contractsCount,
          transactions: transactionsCount,
        },
      });
    }

    await user.deleteOne();
    return res.status(200).json({ message: "User deleted." });
  } catch (err) {
    return handleError(res, err);
  }
}

async function getCategories(_req, res) {
  try {
    const categories = await Category.find().sort({ name: 1 }).lean();
    return res.status(200).json({ categories });
  } catch (err) {
    return handleError(res, err);
  }
}

async function getCategory(req, res) {
  try {
    const category = await Category.findById(req.params.id).lean();
    if (!category) return res.status(404).json({ message: "Category not found." });

    const skills = await Skill.find({ category: category._id }).sort({ name: 1 }).lean();
    return res.status(200).json({ category, skills });
  } catch (err) {
    return handleError(res, err);
  }
}

async function createCategory(req, res) {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const requestedSlug = typeof req.body.slug === "string" ? req.body.slug : name;
    const slug = slugify(requestedSlug);

    if (!name) return res.status(400).json({ message: "Category name is required." });
    if (!slug) return res.status(400).json({ message: "A valid category slug is required." });

    const category = await Category.create({ name, slug });
    return res.status(201).json({ message: "Category created.", category });
  } catch (err) {
    return handleError(res, err);
  }
}

async function updateCategory(req, res) {
  try {
    const updates = {};

    if (Object.hasOwn(req.body, "name")) {
      if (typeof req.body.name !== "string" || !req.body.name.trim()) {
        return res.status(400).json({ message: "Category name cannot be empty." });
      }
      updates.name = req.body.name.trim();
    }

    if (Object.hasOwn(req.body, "slug")) {
      const slug = typeof req.body.slug === "string" ? slugify(req.body.slug) : "";
      if (!slug) return res.status(400).json({ message: "Category slug cannot be empty." });
      updates.slug = slug;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Provide a name or slug to update." });
    }

    const category = await Category.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!category) return res.status(404).json({ message: "Category not found." });
    return res.status(200).json({ message: "Category updated.", category });
  } catch (err) {
    return handleError(res, err);
  }
}

async function deleteCategory(req, res) {
  try {
    const [category, skillsCount, jobsCount] = await Promise.all([
      Category.findById(req.params.id),
      Skill.countDocuments({ category: req.params.id }),
      Job.countDocuments({ category: req.params.id }),
    ]);

    if (!category) return res.status(404).json({ message: "Category not found." });
    if (skillsCount > 0 || jobsCount > 0) {
      return res.status(409).json({
        message: "Category is in use and cannot be deleted.",
        references: { skills: skillsCount, jobs: jobsCount },
      });
    }

    await category.deleteOne();
    return res.status(200).json({ message: "Category deleted." });
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = {
  getStatistics,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
};
