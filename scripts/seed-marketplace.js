const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const { seedMarketplaceData } = require("../services/demoSeed.service");

async function main() {
  try {
    const summary = await seedMarketplaceData({ manageConnection: true });
    console.log("Demo marketplace seed complete.");
    for (const [label, count] of Object.entries(summary)) {
      console.log(`${label}: ${count}`);
    }
  } catch (error) {
    console.error(`Demo marketplace seed failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main();
