const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const SavedItem = require("../models/SavedItem");
const { requireDb } = require("../services/db");

const router = express.Router();

router.use(requireDb);
router.use(auth);

function getUserObjectId(req) {
  if (req.user?.guest === true) {
    const err = new Error("Guest users cannot save items");
    err.code = "GUEST_NO_SAVED";
    throw err;
  }

  const id = req.user?.id;
  if (!id) {
    const err = new Error("Missing user id");
    err.code = "NO_USER_ID";
    throw err;
  }

  if (id instanceof mongoose.Types.ObjectId) return id;
  if (typeof id === "string" && mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(id);
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

function mapSavedItem(doc) {
  return {
    id: String(doc._id),
    _id: String(doc._id),
    name: doc.name || "",
    path: doc.path || "",
    thumbnailUrl: doc.thumbnailUrl || "",
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    type: doc.type || "image",
    score: doc.score ?? null,
    sizeBytes: doc.sizeBytes ?? null,
    mtime: doc.mtime || "",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function listSaved(req, res) {
  try {
    const userId = getUserObjectId(req);
    const userFilter = userIdMatch(userId);
    const rows = await SavedItem.find(userFilter)
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();

    // Guard against historical duplicates: keep latest per path.
    const uniqueByPath = new Map();
    for (const row of rows) {
      const key = String(row.path || "").trim();
      if (!key) continue;
      if (!uniqueByPath.has(key)) uniqueByPath.set(key, row);
    }

    return res.json({ items: Array.from(uniqueByPath.values()).map(mapSavedItem) });
  } catch (err) {
    if (err.code === "GUEST_NO_SAVED") {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: "Failed to fetch saved items" });
  }
}

async function addSaved(req, res) {
  try {
    const userId = getUserObjectId(req);
    const userFilter = userIdMatch(userId);
    const {
      name,
      path,
      thumbnailUrl = "",
      tags = [],
      type = "image",
      score = null,
      sizeBytes = null,
      size = null,
      mtime = "",
    } = req.body || {};

    if (!path || !String(path).trim()) {
      return res.status(400).json({ error: "Path is required" });
    }

    const safePath = String(path).trim();
    const safeName =
      (name && String(name).trim()) || safePath.split(/[\\/]/).pop() || "Saved item";

    const existing = await SavedItem.findOne({ ...userFilter, path: safePath }).lean();
    if (existing) {
      return res.status(409).json({
        ok: false,
        alreadySaved: true,
        message: "Item already saved",
        item: mapSavedItem(existing),
      });
    }

    const created = await SavedItem.create({
      userId,
      name: safeName,
      path: safePath,
      thumbnailUrl: String(thumbnailUrl || ""),
      tags: Array.isArray(tags) ? tags.slice(0, 20) : [],
      type: String(type || "image"),
      score: typeof score === "number" ? score : null,
      sizeBytes:
        typeof sizeBytes === "number"
          ? sizeBytes
          : typeof size === "string"
            ? null
            : null,
      mtime: String(mtime || ""),
    });

    return res.json({ ok: true, item: mapSavedItem(created) });
  } catch (err) {
    if (err.code === "GUEST_NO_SAVED") {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: "Failed to save item" });
  }
}

async function deleteSaved(req, res) {
  try {
    const userId = getUserObjectId(req);
    const userFilter = userIdMatch(userId);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid saved item id" });
    }

    const removed = await SavedItem.findOneAndDelete({ _id: id, ...userFilter }).lean();
    if (!removed) {
      return res.status(404).json({ error: "Saved item not found" });
    }

    return res.json({ ok: true });
  } catch (err) {
    if (err.code === "GUEST_NO_SAVED") {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: "Failed to remove saved item" });
  }
}

async function deleteSavedBulk(req, res) {
  try {
    const userId = getUserObjectId(req);
    const userFilter = userIdMatch(userId);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];

    if (ids.length) {
      const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (!validIds.length) {
        return res.status(400).json({ error: "No valid saved item ids provided" });
      }

      const result = await SavedItem.deleteMany({
        ...userFilter,
        _id: { $in: validIds.map((id) => new mongoose.Types.ObjectId(id)) },
      });

      return res.json({ ok: true, deletedCount: Number(result?.deletedCount || 0) });
    }

    const result = await SavedItem.deleteMany(userFilter);
    return res.json({ ok: true, deletedCount: Number(result?.deletedCount || 0) });
  } catch (err) {
    if (err.code === "GUEST_NO_SAVED") {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: "Failed to clear saved items" });
  }
}

// Canonical routes
router.get("/", listSaved);
router.post("/", addSaved);
router.delete("/", deleteSavedBulk);
router.delete("/:id", deleteSaved);

// Favorites alias routes (for existing renderer calls)
router.get("/favorites", listSaved);
router.post("/favorites", addSaved);
router.delete("/favorites", deleteSavedBulk);
router.delete("/favorites/:id", deleteSaved);

module.exports = router;
