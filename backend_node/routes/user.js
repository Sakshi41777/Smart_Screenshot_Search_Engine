const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const mongoose = require("mongoose");
const { isDbReady } = require("../services/db");

// ✅ SAFE model load (prevents OverwriteModelError)
const User =
  mongoose.models.User ||
  require("../models/user");

/**
 * GET /api/user/me
 * - Authenticated user profile
 * - Guests return lightweight profile (NO DB HIT)
 */
router.get("/me", auth, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    // ✅ GUEST USER → return directly
    if (req.user.guest === true) {
      return res.json({
        id: req.user.id || "guest",
        name: req.user.name || "Guest",
        guest: true,
      });
    }

    if (!isDbReady()) {
      return res.status(503).json({
        ok: false,
        message:
          "Database not connected. Start MongoDB and restart the backend.",
      });
    }

    const userId = req.user.id;

    // safety check
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid user id",
      });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    // Auto-mark Google accounts as verified (one-time backfill)
    if (user.googleId && !user.emailVerified) {
      try {
        await User.updateOne(
          { _id: userId },
          { $set: { emailVerified: true, emailVerifyToken: null, emailVerifyExpires: null } }
        );
        user.emailVerified = true;
        user.emailVerifyToken = undefined;
        user.emailVerifyExpires = undefined;
      } catch {}
    }

    // 🔐 remove sensitive fields
    delete user.password;
    delete user.passwordHash;
    delete user.emailVerifyToken;
    delete user.emailVerifyExpires;
    delete user.__v;

    return res.json(user);
  } catch (err) {
    console.error("GET /api/user/me error:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to load user profile",
    });
  }
});

module.exports = router;
