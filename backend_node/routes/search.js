const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const Search = require("../models/Search");
const User = require("../models/User");

// Save a search (protected)
router.post("/", auth, async (req, res) => {
  try {
    const { query, snippet } = req.body;
    if (!query) return res.status(400).json({ message: "Missing query" });
    const userId = req.user.id;
    const s = new Search({ user: userId, query, snippet: snippet || "" });
    await s.save();
    return res.json({ ok: true, saved: true });
  } catch(err){
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// Get recent searches for current user
router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const items = await Search.find({ user: userId }).sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ ok: true, items });
  } catch(err){
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
