// backend_node/services/ml.js
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const VISUAL_SVC_URL =
  process.env.VISUAL_SVC_URL || "http://127.0.0.1:9001";

const REQUEST_TIMEOUT = 15_000;

// ================= HELPERS =================
function normalizePath(p = "") {
  try {
    return path.resolve(p).replace(/\\/g, "/");
  } catch {
    return p;
  }
}

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

// ================= VISUAL SCORE =================
async function requestVisualScores(paths = []) {
  if (!Array.isArray(paths) || paths.length === 0) return {};

  const clean = paths
    .map(normalizePath)
    .filter(fileExists);

  if (!clean.length) return {};

  try {
    const resp = await axios.post(
      `${VISUAL_SVC_URL}/score`,
      { paths: clean },
      { timeout: REQUEST_TIMEOUT }
    );

    if (resp?.data?.scores && typeof resp.data.scores === "object") {
      return resp.data.scores;
    }
  } catch (e) {
    console.warn("[ML] visual service unavailable");
  }

  // ⚠️ IMPORTANT: fallback MUST be >= 0.5
  const fallback = {};
  for (const p of clean) fallback[p] = 0.6;
  return fallback;
}

// ================= LABELS =================
async function requestLabels(paths = []) {
  if (!Array.isArray(paths) || paths.length === 0) return {};

  const clean = paths
    .map(normalizePath)
    .filter(fileExists);

  if (!clean.length) return {};

  try {
    const resp = await axios.post(
      `${VISUAL_SVC_URL}/label`,
      { paths: clean },
      { timeout: REQUEST_TIMEOUT }
    );

    if (resp?.data?.labels && typeof resp.data.labels === "object") {
      return resp.data.labels;
    }
  } catch {
    console.warn("[ML] label service unavailable");
  }

  return {};
}

// ================= HEURISTIC TAGS =================
function heuristicTagsForPath(p = "") {
  const name = path.basename(p).toLowerCase();
  const tags = [];

  if (name.includes("invoice") || name.includes("bill") || name.includes("receipt"))
    tags.push("invoice");

  if (name.includes("error") || name.includes("trace"))
    tags.push("error");

  if (name.includes("screenshot") || name.includes("screen"))
    tags.push("screenshot");

  if (/\b(ui|dashboard|page)\b/.test(name))
    tags.push("ui");

  const ext = path.extname(name);
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) tags.push("image");
  if (ext === ".pdf") tags.push("document");

  return [...new Set(tags)].slice(0, 6);
}

// ================= TAG SCORE =================
function tagScoreFromTags(tags = []) {
  if (!Array.isArray(tags) || tags.length === 0) return 0.55;

  const WEIGHTS = {
    invoice: 0.85,
    document: 0.7,
    screenshot: 0.75,
    ui: 0.7,
    error: 0.8,
    image: 0.6,
  };

  let score = 0;
  let hits = 0;

  for (const t of tags) {
    if (WEIGHTS[t]) {
      score += WEIGHTS[t];
      hits++;
    }
  }

  if (!hits) return 0.55;
  return Math.min(1, score / hits);
}

// ================= SCORE FUSION =================
function combineScores(visualScore = 0.6, tagScore = 0.6) {
  /**
   * Explainable formula:
   * - vision dominates relevance
   * - tags refine intent
   */
  return Math.max(
    0.3,
    Math.min(1, visualScore * 0.65 + tagScore * 0.35)
  );
}

// ================= OPTIONAL SIMPLE SCORER =================
// Useful when ML microservice is OFF
function scoreFile(file, query = "") {
  let base = 0.6;

  if (query && file?.extractText) {
    const q = query.toLowerCase();
    if (file.extractText.toLowerCase().includes(q)) base += 0.25;
  }

  if (file?.tags?.length) {
    base = combineScores(base, tagScoreFromTags(file.tags));
  }

  return Math.min(1, base);
}

// ================= EXPORT =================
module.exports = {
  requestVisualScores,
  requestLabels,
  heuristicTagsForPath,
  tagScoreFromTags,
  combineScores,
  scoreFile,
};
