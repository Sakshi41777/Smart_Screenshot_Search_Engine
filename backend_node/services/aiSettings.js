// backend_node/services/aiSettings.js
// Optional AI provider settings the user enters in the app (Settings > AI answers).
// Saved as JSON in the app's data folder on this computer only. Values from
// backend_node/.env are used when nothing has been saved (developer setup).
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.SMARTSHOT_DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "ai-settings.json");

const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-flash",
};

function readSaved() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function envConfig() {
  const provider = String(process.env.LLM_PROVIDER || "openai").toLowerCase() === "gemini" ? "gemini" : "openai";
  return {
    provider,
    model: String(process.env.LLM_MODEL || "").trim() || DEFAULT_MODELS[provider],
    openaiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
    geminiKey: process.env.GEMINI_API_KEY || "",
  };
}

// Effective config used for each AI request.
function getAiConfig() {
  const env = envConfig();
  const saved = readSaved();
  const savedProvider = saved.provider === "gemini" ? "gemini" : saved.provider === "openai" ? "openai" : "";
  const provider = savedProvider && saved.apiKey ? savedProvider : env.provider;
  const useSaved = Boolean(savedProvider && saved.apiKey);
  return {
    provider,
    model: (useSaved ? String(saved.model || "").trim() : env.model) || DEFAULT_MODELS[provider],
    openaiKey: useSaved && provider === "openai" ? saved.apiKey : env.openaiKey,
    geminiKey: useSaved && provider === "gemini" ? saved.apiKey : env.geminiKey,
    openaiBase: String(process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    geminiBase: String(process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, ""),
    fromSettings: useSaved,
  };
}

function hasAiKey() {
  const cfg = getAiConfig();
  return Boolean(cfg.provider === "gemini" ? cfg.geminiKey : cfg.openaiKey);
}

// What the Settings screen may see (never the full key).
function getPublicAiSettings() {
  const saved = readSaved();
  const cfg = getAiConfig();
  const key = cfg.provider === "gemini" ? cfg.geminiKey : cfg.openaiKey;
  return {
    provider: cfg.provider,
    model: cfg.model,
    hasKey: Boolean(key),
    keyHint: key ? `…${String(key).slice(-4)}` : "",
    savedInApp: Boolean(saved.apiKey),
    defaultModels: DEFAULT_MODELS,
  };
}

function saveAiSettings({ provider, apiKey, model, clear } = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (clear) {
    try { fs.unlinkSync(FILE); } catch {}
    return getPublicAiSettings();
  }
  const prev = readSaved();
  const p = provider === "gemini" ? "gemini" : "openai";
  const next = {
    provider: p,
    model: String(model || "").trim() || DEFAULT_MODELS[p],
    // Keep the existing key when the form leaves the key field empty.
    apiKey: String(apiKey || "").trim() || (prev.provider === p ? prev.apiKey || "" : ""),
  };
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return getPublicAiSettings();
}

module.exports = { getAiConfig, hasAiKey, getPublicAiSettings, saveAiSettings, DEFAULT_MODELS };
