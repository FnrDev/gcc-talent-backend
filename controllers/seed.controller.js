const { seedMarketplaceData } = require("../services/demoSeed.service");
const { recordAuditLog } = require("../services/audit.service");

async function seedMarketplace(req, res) {
  try {
    const summary = await seedMarketplaceData();

    await recordAuditLog(req, {
      action: "create",
      resource: "DemoSeed",
      details: {
        operation: "seedMarketplace",
        database: summary.database,
        counts: summary,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Local demo marketplace data is ready.",
      data: { summary },
    });
  } catch (error) {
    const unsafeTarget = /production|local MongoDB|MONGODB_URI|connection is required/i.test(error.message);
    if (unsafeTarget) {
      return res.status(403).json({ success: false, message: error.message });
    }

    console.error(error);
    return res.status(500).json({ success: false, message: "Could not seed demo marketplace data." });
  }
}

module.exports = { seedMarketplace };
