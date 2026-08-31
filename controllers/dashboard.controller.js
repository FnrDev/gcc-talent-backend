const mongoose = require("mongoose");

const {
  User,
  Job,
  Proposal,
  Contract,
  Transaction,
  Service,
} = require("../models");

function countsToObject(rows, expectedKeys = []) {
  const counts = Object.fromEntries(expectedKeys.map((key) => [key, 0]));

  for (const row of rows) {
    if (row._id != null) counts[row._id] = row.count;
  }

  return counts;
}

function handleError(res, error) {
  console.error(error);
  return res.status(500).json({ success: false, message: "Internal Server Error" });
}

async function getClientDashboard(user) {
  const userId = user._id;
  const [jobRows, contractRows, recentJobs, recentContracts, spendingRows] = await Promise.all([
    Job.aggregate([
      { $match: { client: userId } },
      { $group: { _id: "$status", count: { $sum: 1 }, proposals: { $sum: "$proposalsCount" } } },
    ]),
    Contract.aggregate([
      { $match: { client: userId } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          serviceOrders: {
            $sum: { $cond: [{ $eq: ["$source.type", "service"] }, 1, 0] },
          },
        },
      },
    ]),
    Job.find({ client: userId })
      .select("title status proposalsCount budgetType budgetMin budgetMax createdAt")
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean(),
    Contract.find({ client: userId })
      .select("title status totalAmount currency source.type updatedAt")
      .populate("freelancer", "name avatarUrl")
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean(),
    Transaction.aggregate([
      {
        $match: {
          user: userId,
          status: "completed",
          direction: "debit",
          type: { $in: ["escrow_fund"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const jobs = countsToObject(jobRows, ["draft", "open", "in_progress", "completed", "closed"]);
  const contracts = countsToObject(contractRows, ["active", "completed", "cancelled"]);
  const totalProposals = jobRows.reduce((total, row) => total + (row.proposals || 0), 0);
  const serviceOrders = contractRows.reduce((total, row) => total + (row.serviceOrders || 0), 0);

  return {
    role: "client",
    stats: {
      openJobs: jobs.open,
      activeContracts: contracts.active,
      proposalsReceived: totalProposals,
      serviceOrders,
      totalSpent: spendingRows[0]?.total || 0,
      currency: "BHD",
    },
    recent: { jobs: recentJobs, contracts: recentContracts },
    quickActions: [
      { label: "Post a job", href: "/jobs/new" },
      { label: "Manage jobs", href: "/jobs/mine" },
      { label: "Track orders", href: "/orders" },
      { label: "Browse services", href: "/services" },
    ],
  };
}

async function getFreelancerDashboard(user) {
  const userId = user._id;
  const [proposalRows, contractRows, activeServices, recentProposals, recentContracts, earningsRows] = await Promise.all([
    Proposal.aggregate([
      { $match: { freelancer: userId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Contract.aggregate([
      { $match: { freelancer: userId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Service.countDocuments({ freelancer: userId }),
    Proposal.find({ freelancer: userId })
      .select("job amount deliveryDays status updatedAt")
      .populate("job", "title status")
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean(),
    Contract.find({ freelancer: userId })
      .select("title status totalAmount currency source.type updatedAt")
      .populate("client", "name avatarUrl")
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean(),
    Transaction.aggregate([
      {
        $match: {
          user: userId,
          status: "completed",
          type: { $in: ["escrow_release", "platform_fee"] },
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [{ $eq: ["$direction", "credit"] }, "$amount", { $multiply: ["$amount", -1] }],
            },
          },
        },
      },
    ]),
  ]);

  const proposals = countsToObject(proposalRows, ["pending", "shortlisted", "accepted", "declined", "withdrawn"]);
  const contracts = countsToObject(contractRows, ["active", "completed", "cancelled"]);

  return {
    role: "freelancer",
    stats: {
      activeProposals: proposals.pending + proposals.shortlisted,
      acceptedProposals: proposals.accepted,
      activeContracts: contracts.active,
      completedContracts: contracts.completed,
      activeServices,
      totalEarned: earningsRows[0]?.total || 0,
      currency: "BHD",
    },
    recent: { proposals: recentProposals, contracts: recentContracts },
    quickActions: [
      { label: "Browse jobs", href: "/jobs" },
      { label: "Track proposals", href: "/proposals" },
      { label: "Create a service", href: "/services/new" },
      { label: "View wallet", href: "/wallet" },
    ],
  };
}

async function getAdminDashboard() {
  const [userRows, jobRows, contractRows, transactionRows, recentUsers] = await Promise.all([
    User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
    Job.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Contract.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Transaction.aggregate([
      { $match: { status: "completed" } },
      {
        $group: {
          _id: null,
          volume: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    User.find().select("name email role status createdAt").sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  const users = countsToObject(userRows, ["client", "freelancer", "admin"]);
  const jobs = countsToObject(jobRows, ["draft", "open", "in_progress", "completed", "closed"]);
  const contracts = countsToObject(contractRows, ["active", "completed", "cancelled"]);

  return {
    role: "admin",
    stats: {
      totalUsers: users.client + users.freelancer + users.admin,
      clients: users.client,
      freelancers: users.freelancer,
      openJobs: jobs.open,
      activeContracts: contracts.active,
      transactionVolume: transactionRows[0]?.volume || 0,
      transactionCount: transactionRows[0]?.count || 0,
      currency: "BHD",
    },
    recent: { users: recentUsers },
    quickActions: [{ label: "Open admin panel", href: "/admin" }],
  };
}

async function getDashboard(req, res) {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);
    const user = await User.findById(userId).select("name role status wallet").lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    let dashboard;
    if (user.role === "client") dashboard = await getClientDashboard(user);
    else if (user.role === "freelancer") dashboard = await getFreelancerDashboard(user);
    else dashboard = await getAdminDashboard();

    return res.status(200).json({
      success: true,
      data: {
        ...dashboard,
        wallet: {
          available: user.wallet?.available || 0,
          pending: user.wallet?.pending || 0,
          currency: "BHD",
        },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = { getDashboard };
