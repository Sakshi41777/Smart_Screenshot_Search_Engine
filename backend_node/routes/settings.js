// backend_node/routes/settings.js
// Optional AI key for "Ask about this file" (stored on this computer only).
const express = require("express");
const axios = require("axios");
const { getAiConfig, getPublicAiSettings, saveAiSettings } = require("../services/aiSettings");

const router = express.Router();

router.get("/ai", (_req, res) => {
  res.json({ ok: true, ...getPublicAiSettings() });
});

router.post("/ai", (req, res) => {
  try {
    const { provider, apiKey, model, clear } = req.body || {};
    const saved = saveAiSettings({ provider, apiKey, model, clear: Boolean(clear) });
    res.json({ ok: true, ...saved });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Couldn't save AI settings." });
  }
});

// Quick check that the saved key works.
router.post("/ai/test", async (_req, res) => {
  const cfg = getAiConfig();
  try {
    if (cfg.provider === "gemini") {
      if (!cfg.geminiKey) return res.json({ ok: false, error: "Add a Gemini key first." });
      await axios.post(
        `${cfg.geminiBase}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.geminiKey)}`,
        { contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }], generationConfig: { maxOutputTokens: 5 } },
        { timeout: 15000 }
      );
    } else {
      if (!cfg.openaiKey) return res.json({ ok: false, error: "Add an OpenAI key first." });
      await axios.post(
        `${cfg.openaiBase}/chat/completions`,
        { model: cfg.model, max_tokens: 5, messages: [{ role: "user", content: "Reply with OK." }] },
        { headers: { Authorization: `Bearer ${cfg.openaiKey}` }, timeout: 15000 }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    const status = err?.response?.status;
    const msg = err?.response?.data?.error?.message || err?.message || "Request failed";
    const hint =
      status === 401 || status === 403
        ? "The key was rejected. Check that you copied it correctly."
        : status === 404
          ? "That model name wasn't found. Check the model name."
          : status === 429
            ? "The key works but has no quota or credits left."
            : "Couldn't reach the AI service. Check your internet connection.";
    res.json({ ok: false, error: hint, detail: String(msg).slice(0, 200) });
  }
});

module.exports = router;
