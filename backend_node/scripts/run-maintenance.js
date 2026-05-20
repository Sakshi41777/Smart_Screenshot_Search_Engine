require("dotenv").config();
const mongoose = require("mongoose");
const { runMaintenance } = require("../services/maintenance");

function hasFlag(flag) {
  return process.argv.some((arg) => arg === flag);
}

async function main() {
  const dryRun = hasFlag("--dry") || !hasFlag("--apply");
  const MONGO_URI = process.env.MONGO_URI || "";

  if (!MONGO_URI) {
    console.error("MONGO_URI is required for maintenance.");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { autoIndex: false });
  console.log(`[maintenance] connected to MongoDB | dryRun=${dryRun}`);

  const summary = await runMaintenance({ dryRun, logger: console });
  console.log("[maintenance] summary:", JSON.stringify(summary, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[maintenance] failed:", err.message);
  process.exit(1);
});

