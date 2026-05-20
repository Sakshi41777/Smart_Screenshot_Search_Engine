const fs = require("fs");
const path = require("path");

let HistoryModel = null;
try {
  HistoryModel = require("../models/History");
} catch {}

function toBool(value, fallback = false) {
  if (value == null) return fallback;
  const v = String(value).toLowerCase().trim();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatMB(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

async function cleanupDirectoryByAge({
  dirPath,
  olderThanDays,
  dryRun,
  logger,
}) {
  const summary = {
    dirPath,
    scanned: 0,
    deleted: 0,
    reclaimedBytes: 0,
    errors: 0,
  };

  if (!dirPath || !fs.existsSync(dirPath)) return summary;
  const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  let files = [];
  try {
    files = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    logger?.warn?.(`[maintenance] failed to read ${dirPath}: ${err.message}`);
    summary.errors += 1;
    return summary;
  }

  for (const entry of files) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(dirPath, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      summary.scanned += 1;
      if (stat.mtimeMs > cutoffMs) continue;

      if (!dryRun) fs.unlinkSync(fullPath);
      summary.deleted += 1;
      summary.reclaimedBytes += stat.size || 0;
    } catch {
      summary.errors += 1;
    }
  }

  return summary;
}

async function cleanupHistoryByAge({
  olderThanDays,
  dryRun,
  logger,
}) {
  const summary = {
    checked: 0,
    deleted: 0,
    errors: 0,
  };

  if (!HistoryModel) return summary;
  const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  try {
    const query = { updatedAt: { $lt: cutoffDate } };
    summary.checked = await HistoryModel.countDocuments(query);
    if (!dryRun && summary.checked > 0) {
      const result = await HistoryModel.deleteMany(query);
      summary.deleted = Number(result?.deletedCount || 0);
    }
  } catch (err) {
    summary.errors += 1;
    logger?.warn?.(`[maintenance] history cleanup failed: ${err.message}`);
  }

  return summary;
}

async function runMaintenance({ dryRun = true, logger = console } = {}) {
  const uploadsDir = path.join(process.cwd(), "uploads");
  const thumbsDir = path.join(process.cwd(), "thumb_cache");

  const uploadsRetentionDays = toNum(process.env.CLEANUP_UPLOADS_DAYS, 30);
  const thumbsRetentionDays = toNum(process.env.CLEANUP_THUMBS_DAYS, 14);
  const historyRetentionDays = toNum(process.env.CLEANUP_HISTORY_DAYS, 30);

  const uploads = await cleanupDirectoryByAge({
    dirPath: uploadsDir,
    olderThanDays: uploadsRetentionDays,
    dryRun,
    logger,
  });
  const thumbs = await cleanupDirectoryByAge({
    dirPath: thumbsDir,
    olderThanDays: thumbsRetentionDays,
    dryRun,
    logger,
  });
  const history = await cleanupHistoryByAge({
    olderThanDays: historyRetentionDays,
    dryRun,
    logger,
  });

  const reclaimedBytes = uploads.reclaimedBytes + thumbs.reclaimedBytes;

  const summary = {
    dryRun,
    uploads,
    thumbs,
    history,
    reclaimedMB: formatMB(reclaimedBytes),
  };

  logger?.info?.(
    `[maintenance] ${dryRun ? "dry-run" : "run"} complete | uploads deleted=${uploads.deleted}/${uploads.scanned}, thumbs deleted=${thumbs.deleted}/${thumbs.scanned}, history deleted=${history.deleted}/${history.checked}, reclaimed=${summary.reclaimedMB} MB`
  );
  return summary;
}

function startMaintenanceScheduler({ logger = console } = {}) {
  const enabled = toBool(process.env.CLEANUP_ENABLED, false);
  if (!enabled) {
    logger?.info?.("[maintenance] scheduler disabled (CLEANUP_ENABLED=false)");
    return null;
  }

  const intervalHours = toNum(process.env.CLEANUP_INTERVAL_HOURS, 24);
  const dryRun = toBool(process.env.CLEANUP_DRY_RUN, true);
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;

  logger?.info?.(
    `[maintenance] scheduler enabled | every ${intervalHours}h | dryRun=${dryRun}`
  );

  runMaintenance({ dryRun, logger }).catch((err) =>
    logger?.warn?.(`[maintenance] initial run failed: ${err.message}`)
  );

  const timer = setInterval(() => {
    runMaintenance({ dryRun, logger }).catch((err) =>
      logger?.warn?.(`[maintenance] scheduled run failed: ${err.message}`)
    );
  }, intervalMs);

  return timer;
}

module.exports = {
  runMaintenance,
  startMaintenanceScheduler,
};

