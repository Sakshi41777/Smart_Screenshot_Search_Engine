// backend_node/routes/history.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const authMiddleware = require("../middleware/auth");
const { requireDb } = require("../services/db");

// ✅ SAFE MODEL LOAD (prevents OverwriteModelError)
const History =
  mongoose.models.History ||
  require("../models/History");

// 🔐 require authentication for all history endpoints
router.use(requireDb);
router.use(authMiddleware);

/**
 * Helper: validate and return ObjectId userId
 * - Blocks guest users
 */
function getValidatedUserObjectId(req) {
  if (req.user?.guest === true) {
    const err = new Error("Guest users do not have persistent history");
    err.code = "GUEST_NO_HISTORY";
    throw err;
  }

  const rawId = req.user?.id;
  if (!rawId) {
    const err = new Error("No user id available");
    err.code = "NO_USER_ID";
    throw err;
  }

  // already ObjectId
  if (rawId instanceof mongoose.Types.ObjectId) return rawId;

  // valid ObjectId string
  if (typeof rawId === "string" && mongoose.Types.ObjectId.isValid(rawId)) {
    return new mongoose.Types.ObjectId(rawId);
  }

  const err = new Error("Invalid user id");
  err.code = "INVALID_USER_ID";
  throw err;
}

function userIdMatch(raw) {
  const asString = String(raw);
  if (raw instanceof mongoose.Types.ObjectId) {
    return { $or: [{ userId: raw }, { userId: asString }] };
  }
  if (typeof raw === "string" && mongoose.Types.ObjectId.isValid(raw)) {
    return {
      $or: [{ userId: new mongoose.Types.ObjectId(raw) }, { userId: raw }],
    };
  }
  return { userId: raw };
}

function normalizeQueryText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * GET /api/search/history
 */
router.get("/", async (req, res) => {
  try {
    const userId = getValidatedUserObjectId(req);
    const userFilter = userIdMatch(userId);

    // Group same queries into one entry (latest search wins).
    const entries = await History.find(userFilter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(2000)
      .lean();

    const grouped = new Map();
    for (const e of entries) {
      const key = e.queryKey || normalizeQueryText(e.query);
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, e);
    }

    const items = Array.from(grouped.values())
      .sort((a, b) => {
        const aTs = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
        const bTs = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
        return bTs - aTs;
      })
      .slice(0, 50)
      .map((e) => ({
        id: String(e._id),
        _id: String(e._id),
        query: e.query,
        title: e.query,
        path: e.path || "",
        folderPath: e.path || "",
        timestamp:
          e.timestamp ||
          e.updatedAt?.toISOString?.() ||
          e.createdAt?.toISOString?.(),
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      }));

    return res.json({ items });
  } catch (err) {
    if (err.code === "GUEST_NO_HISTORY")
      return res.status(403).json({ error: err.message });

    if (
      err.code === "INVALID_USER_ID" ||
      err.code === "NO_USER_ID"
    ) {
      return res.status(400).json({ error: err.message });
    }

    console.error("History GET error:", err);
    return res.status(500).json({ error: "Failed to fetch history" });
  }
});

/**
 * POST /api/search/history
 */
router.post("/", async (req, res) => {
  try {
    const userId = getValidatedUserObjectId(req);
    const { query, path, folderPath } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({ error: "Query is required" });
    }

    const cleanQuery = query.trim();
    const cleanPath = String(path || folderPath || "").trim();
    const queryKey = normalizeQueryText(cleanQuery);
    const nowIso = new Date().toISOString();

    const userFilter = userIdMatch(userId);
    const created = await History.findOneAndUpdate(
      {
        ...userFilter,
        queryKey,
      },
      {
        $set: {
          query: cleanQuery,
          queryKey,
          path: cleanPath,
          timestamp: nowIso,
        },
        $setOnInsert: {
          userId,
        },
      },
      {
        upsert: true,
        new: true,
      }
    ).lean();

    return res.json({
      ok: true,
      item: {
        id: String(created._id),
        _id: String(created._id),
        query: created.query,
        title: created.query,
        path: created.path || "",
        folderPath: created.path || "",
        timestamp: created.timestamp,
        createdAt: created.createdAt,
      },
    });
  } catch (err) {
    if (err.code === "GUEST_NO_HISTORY")
      return res.status(403).json({ error: err.message });

    if (
      err.code === "INVALID_USER_ID" ||
      err.code === "NO_USER_ID"
    ) {
      return res.status(400).json({ error: err.message });
    }

    console.error("History POST error:", err);
    return res.status(500).json({ error: "Failed to save history" });
  }
});

/**
 * DELETE /api/search/history/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const userId = getValidatedUserObjectId(req);
    const userFilter = userIdMatch(userId);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid history id" });
    }

    const deleted = await History.findOneAndDelete({
      _id: id,
      ...userFilter,
    });

    if (!deleted) {
      return res.status(404).json({ error: "History entry not found" });
    }

    return res.json({ ok: true });
  } catch (err) {
    if (err.code === "GUEST_NO_HISTORY")
      return res.status(403).json({ error: err.message });

    console.error("History DELETE error:", err);
    return res.status(500).json({ error: "Failed to delete history" });
  }
});

/**
 * DELETE /api/search/history
 * Body (optional): { ids: string[] }
 * - no ids: delete all history for user
 * - with ids: delete selected history entries for user
 */
router.delete("/", async (req, res) => {
  try {
    const userId = getValidatedUserObjectId(req);
    const userFilter = userIdMatch(userId);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];

    if (ids.length) {
      const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (!validIds.length) {
        return res.status(400).json({ error: "No valid history ids provided" });
      }

      const result = await History.deleteMany({
        ...userFilter,
        _id: { $in: validIds.map((id) => new mongoose.Types.ObjectId(id)) },
      });

      return res.json({ ok: true, deletedCount: Number(result?.deletedCount || 0) });
    }

    const result = await History.deleteMany(userFilter);
    return res.json({ ok: true, deletedCount: Number(result?.deletedCount || 0) });
  } catch (err) {
    if (err.code === "GUEST_NO_HISTORY")
      return res.status(403).json({ error: err.message });

    console.error("History BULK DELETE error:", err);
    return res.status(500).json({ error: "Failed to clear history" });
  }
});

module.exports = router;
