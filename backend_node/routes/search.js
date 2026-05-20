const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const multer = require("multer");
const crypto = require("crypto");
const sharp = require("sharp");
const axios = require("axios");
const FormData = require("form-data");

const router = express.Router();
const { sendProgress } = require("./searchProgress");
const { extractTextSafe, describeImageSemanticSafe } = require("../services/ocr");
const { requireDb } = require("../services/db");

/* =========================
   Mongo Model
========================= */
let IndexedFileModel;
try {
  IndexedFileModel = require("../models/IndexedFile");
  console.log("✅ IndexedFile model loaded");
} catch {
  console.error("❌ IndexedFile model missing");
}

let HistoryModel;
try {
  HistoryModel = require("../models/History");
} catch {}

let SavedItemModel;
try {
  SavedItemModel = require("../models/SavedItem");
} catch {}

let SearchModel;
try {
  SearchModel = require("../models/Search");
} catch {}

// Ensure DB is connected before any search/index routes run.
router.use(requireDb);

/* =========================
   UPLOAD DIRECTORY (Browser mode only)
========================= */
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/* =========================
   MULTER (Browser fallback)
========================= */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename: (_, file, cb) =>
      cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 500,
  },
});

/* =========================
   CONSTANTS
========================= */
// Index all file types. OCR extraction is handled safely in services/ocr.js
// and returns empty text for unsupported formats.

const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp",
]);

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".cache",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
  "target",
  "out",
  "bin",
  "obj",
]);

const MAIN_INDEX_EXTS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp",
  // Documents
  ".pdf", ".txt", ".md", ".csv", ".log",
  // Source code
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs",
  ".php", ".rb", ".swift", ".kt", ".kts", ".sql",
  // Markup/config
  ".json", ".xml", ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg", ".env",
  // Scripts
  ".sh", ".bat", ".ps1",
]);

const MAIN_INDEX_BASENAMES = new Set([
  "dockerfile",
  ".gitignore",
  "readme",
  "readme.md",
  "license",
  "makefile",
]);

const SKIP_FILE_BASENAMES = new Set([
  "desktop.ini",
  "thumbs.db",
]);

const INDEXING_STATE = {
  running: false,
  cancelRequested: false,
};

function shouldSkipDirectory(entryName = "") {
  return SKIP_DIR_NAMES.has(String(entryName || "").toLowerCase());
}

function shouldIndexFile(filePath = "") {
  const base = path.basename(filePath || "").toLowerCase();
  if (SKIP_FILE_BASENAMES.has(base)) return false;
  if (MAIN_INDEX_BASENAMES.has(base)) return true;
  const ext = path.extname(filePath || "").toLowerCase();
  return MAIN_INDEX_EXTS.has(ext);
}

async function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", (err) => reject(err));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

const LLM_PROVIDER = String(process.env.LLM_PROVIDER || "openai").toLowerCase();
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";

const OPENAI_BASE_URL = (process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";

const GEMINI_BASE_URL = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const AI_QUERY_ASSIST = String(process.env.AI_QUERY_ASSIST || "true").toLowerCase() === "true";
const AI_QUERY_TIMEOUT_MS = Number(process.env.AI_QUERY_TIMEOUT_MS || 12000);
const AI_QUERY_MIN_CHARS = Number(process.env.AI_QUERY_MIN_CHARS || 4);
const AI_LLM_RERANK_ENABLED =
  String(process.env.AI_LLM_RERANK_ENABLED || "true").toLowerCase() === "true";
const AI_LLM_RERANK_MAX_CANDIDATES = Number(process.env.AI_LLM_RERANK_MAX_CANDIDATES || 80);
const AI_LLM_RERANK_TIMEOUT_MS = Number(process.env.AI_LLM_RERANK_TIMEOUT_MS || 12000);
const QUERY_HINT_CACHE = new Map();
const QUERY_HINT_CACHE_MAX = 200;
const AI_SEMANTIC_SEARCH = String(process.env.AI_SEMANTIC_SEARCH || "true").toLowerCase() === "true";
const AI_SEMANTIC_MODEL = process.env.AI_SEMANTIC_MODEL || (LLM_PROVIDER === "gemini" ? "text-embedding-004" : "text-embedding-3-small");
const AI_SEMANTIC_MAX_CANDIDATES = Number(process.env.AI_SEMANTIC_MAX_CANDIDATES || 220);
const AI_SEMANTIC_TIMEOUT_MS = Number(process.env.AI_SEMANTIC_TIMEOUT_MS || 12000);
const AI_RATE_LIMIT_COOLDOWN_MS = Number(process.env.AI_RATE_LIMIT_COOLDOWN_MS || 10 * 60 * 1000);
let aiRateLimitedUntil = 0;
const HYBRID_RANKING_ENABLED =
  String(process.env.HYBRID_RANKING_ENABLED || "true").toLowerCase() !== "false";
const HYBRID_MIN_CONFIDENCE = Number(process.env.HYBRID_MIN_CONFIDENCE || 0.38);
const HYBRID_MAX_RESULTS = Number(process.env.HYBRID_MAX_RESULTS || 300);
const OCR_SKIP_IF_EXISTS =
  String(process.env.OCR_SKIP_IF_EXISTS || "true").toLowerCase() === "true";
const LOCAL_VISION_URL = String(process.env.LOCAL_VISION_URL || "http://127.0.0.1:5055").replace(/\/+$/, "");
const CLIP_IMAGE_RERANK_ENABLED =
  String(process.env.CLIP_IMAGE_RERANK_ENABLED || "true").toLowerCase() === "true";
const CLIP_MODEL = String(process.env.LOCAL_CLIP_MODEL || "ViT-B-32").trim();
const CLIP_PRETRAINED = String(process.env.LOCAL_CLIP_PRETRAINED || "laion2b_s34b_b79k").trim();
const CLIP_TIMEOUT_MS = Number(process.env.CLIP_TIMEOUT_MS || 8000);
const CLIP_MIN_CHARS = Number(process.env.CLIP_MIN_CHARS || 3);
const CLIP_MAX_CANDIDATES = Number(process.env.CLIP_MAX_CANDIDATES || 200);
const CLOUDINARY_CLOUD_NAME = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
const CLOUDINARY_UPLOAD_PRESET = String(process.env.CLOUDINARY_UPLOAD_PRESET || "").trim();
const CLOUDINARY_API_KEY = String(process.env.CLOUDINARY_API_KEY || "").trim();
const CLOUDINARY_API_SECRET = String(process.env.CLOUDINARY_API_SECRET || "").trim();
const CLOUDINARY_FOLDER = String(process.env.CLOUDINARY_FOLDER || "smartshot-shares").trim();
const OPEN_VOCAB_IMAGE_INDEX =
  String(process.env.OPEN_VOCAB_IMAGE_INDEX || "true").toLowerCase() !== "false";
const OPEN_VOCAB_QUERY_ENRICH_LIMIT = Number(process.env.OPEN_VOCAB_QUERY_ENRICH_LIMIT || 20);
const OPENAI_FALLBACK_MODEL = String(
  process.env.OPENAI_FALLBACK_MODEL || "gpt-4o-mini"
).trim();

function normalizeModelName(model = "") {
  return String(model || "").trim().replace(/\s+/g, "-").replace(/_/g, "-").toLowerCase();
}

function getPrimaryLlmModel() {
  const normalized = normalizeModelName(LLM_MODEL);
  return normalized || "gpt-4o-mini";
}

function getOpenAiModelCandidates() {
  const primary = getPrimaryLlmModel();
  const fallback = normalizeModelName(OPENAI_FALLBACK_MODEL) || "gpt-4o-mini";
  return [...new Set([primary, fallback].filter(Boolean))];
}

function isAiRateLimitError(err) {
  return Number(err?.response?.status) === 429;
}

function markAiRateLimited(err) {
  if (!isAiRateLimitError(err)) return;
  aiRateLimitedUntil = Date.now() + AI_RATE_LIMIT_COOLDOWN_MS;
}

function getAiCooldownSeconds() {
  return Math.max(0, Math.ceil((aiRateLimitedUntil - Date.now()) / 1000));
}

function assertAiNotRateLimited() {
  const seconds = getAiCooldownSeconds();
  if (seconds <= 0) return;
  const err = new Error(`AI provider is rate limited. Retry in ${seconds}s or disable AI features.`);
  err.statusCode = 429;
  throw err;
}

async function computeDhash(filePath) {
  const buffer = await sharp(filePath)
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = buffer[y * 9 + x];
      const right = buffer[y * 9 + x + 1];
      bits += left > right ? "1" : "0";
    }
  }

  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

function hammingDistanceHex(a = "", b = "") {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const da = parseInt(a[i], 16);
    const db = parseInt(b[i], 16);
    let xor = da ^ db;
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenizeQuery(raw = "") {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function isVisualSemanticIntent(rawQuery = "") {
  const q = String(rawQuery || "").toLowerCase().trim();
  if (!q) return false;
  return /\b(person|people|man|woman|boy|girl|face|selfie|portrait|shirt|tshirt|t-shirt|saree|dress|jacket|blue|red|green|black|white|yellow|board|whiteboard|classroom|meeting|crowd|group|logo|icon)\b/.test(q);
}

function expandIntentTokens(tokens = [], rawQuery = "") {
  const base = [...new Set((Array.isArray(tokens) ? tokens : []).filter(Boolean))];
  const expanded = new Set(base);
  const q = String(rawQuery || "").toLowerCase();

  if (isFaceIntent(q)) {
    [
      "person",
      "people",
      "face",
      "human",
      "portrait",
      "selfie",
      "man",
      "woman",
      "boy",
      "girl",
      "headshot",
      "board",
      "whiteboard",
      "blackboard",
    ].forEach((t) => expanded.add(t));
  }

  return [...expanded];
}

function isDuplicateIntent(rawQuery = "") {
  const q = String(rawQuery || "").toLowerCase();
  if (!q.trim()) return false;
  return /\b(duplicate|duplicates|identical|same|copy|copies|clones?)\b/.test(q);
}

function isFaceIntent(rawQuery = "") {
  const q = String(rawQuery || "").toLowerCase();
  if (!q.trim()) return false;
  return /\b(face|selfie|person|people|human|portrait|headshot)\b/.test(q);
}

function buildRegexAndQuery(tokens) {
  if (!tokens.length) return {};
  return {
    $and: tokens.map((t) => {
      const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      return {
        $or: [{ name: re }, { path: re }, { extractedText: re }],
      };
    }),
  };
}

function combineQueries(...parts) {
  const valid = parts.filter((p) => p && typeof p === "object" && Object.keys(p).length);
  if (!valid.length) return {};
  if (valid.length === 1) return valid[0];
  return { $and: valid };
}

function normalizeScopeFolders(raw = []) {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .map((p) => p.replace(/[\\/]+$/, ""))
    .filter((p, idx, arr) => arr.indexOf(p) === idx);
}

function normalizePathForMatch(raw = "") {
  try {
    return path.resolve(String(raw || "")).replace(/[\\/]+$/, "").toLowerCase();
  } catch {
    return String(raw || "").trim().replace(/[\\/]+$/, "").toLowerCase();
  }
}

function normalizePathKey(raw = "") {
  const trimmed = String(raw || "").trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  if (path.isAbsolute(trimmed)) {
    try {
      return path.resolve(trimmed).replace(/[\\/]+$/, "").toLowerCase();
    } catch {
      return trimmed.toLowerCase();
    }
  }
  return trimmed.toLowerCase();
}

function isPathWithinFolders(targetPath = "", folders = []) {
  const t = normalizePathForMatch(targetPath);
  if (!t) return false;
  const roots = normalizeScopeFolders(folders);
  if (!roots.length) return true;
  return roots.some((root) => {
    const r = normalizePathForMatch(root);
    return t === r || t.startsWith(`${r}\\`) || t.startsWith(`${r}/`);
  });
}

function extractRecentFolderIntent(rawQuery = "") {
  const q = String(rawQuery || "").trim();
  if (!q) return null;
  const m = q.match(
    /\b(?:show|list|find)?\s*(?:the\s+)?(?:recent|latest|newest)\s+(?:files|items)?\s*(?:in|from)\s+(.+)$/i
  );
  if (!m?.[1]) return null;
  const folderHint = String(m[1]).trim().replace(/^["']|["']$/g, "");
  if (!folderHint) return null;
  return { folderHint };
}

function resolveFolderFromHint(folderHint = "", scopeFolders = []) {
  const hint = String(folderHint || "").trim();
  if (!hint) return "";

  // Absolute/local path provided directly.
  if (fs.existsSync(hint)) {
    try {
      if (fs.statSync(hint).isDirectory()) return path.resolve(hint);
    } catch {}
  }

  const hintLc = hint.toLowerCase();
  const normalizedScope = normalizeScopeFolders(scopeFolders);
  const exactScope = normalizedScope.find(
    (p) => path.basename(p).toLowerCase() === hintLc
  );
  if (exactScope) return exactScope;

  const home = os.homedir();
  const knownCandidates = [
    path.join(home, "Downloads"),
    path.join(home, "Documents"),
    path.join(home, "Desktop"),
    path.join(home, "Pictures"),
    path.join(home, "Videos"),
    path.join(home, "Music"),
    path.join(home, "OneDrive", "Downloads"),
    path.join(home, "OneDrive", "Documents"),
    path.join(home, "OneDrive", "Desktop"),
    path.join(home, "OneDrive", "Pictures"),
  ];
  const exactKnown = knownCandidates.find((p) => {
    try {
      return fs.existsSync(p) && path.basename(p).toLowerCase() === hintLc;
    } catch {
      return false;
    }
  });
  if (exactKnown) return exactKnown;

  // Last fallback: contains match from selected scope folders.
  const fuzzyScope = normalizedScope.find((p) =>
    String(p).toLowerCase().includes(hintLc)
  );
  if (fuzzyScope) return fuzzyScope;

  // Deep fallback: search common roots for a matching folder name.
  function findFolderByNameInRoots(targetName = "", roots = [], maxDepth = 4, maxVisited = 4000) {
    const target = String(targetName || "").toLowerCase().trim();
    if (!target) return "";
    const queue = [];
    const seen = new Set();
    let visited = 0;

    roots.forEach((r) => {
      const root = String(r || "").trim();
      if (!root) return;
      try {
        if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return;
      } catch {
        return;
      }
      queue.push({ dir: root, depth: 0 });
      seen.add(path.resolve(root).toLowerCase());
    });

    while (queue.length && visited < maxVisited) {
      const current = queue.shift();
      visited += 1;
      const base = path.basename(current.dir || "").toLowerCase();
      if (base === target) return current.dir;
      if (current.depth >= maxDepth) continue;

      let rows = [];
      try {
        rows = fs.readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of rows) {
        if (!entry?.isDirectory?.()) continue;
        const name = String(entry.name || "");
        if (!name || name.startsWith(".") || shouldSkipDirectory(name)) continue;
        const child = path.join(current.dir, name);
        let real = "";
        try {
          real = path.resolve(child).toLowerCase();
        } catch {
          continue;
        }
        if (seen.has(real)) continue;
        seen.add(real);
        queue.push({ dir: child, depth: current.depth + 1 });
      }
    }
    return "";
  }

  const deepRoots = [
    path.join(home, "Downloads"),
    path.join(home, "Documents"),
    path.join(home, "Desktop"),
    path.join(home, "Pictures"),
    path.join(home, "OneDrive"),
  ];
  const deepMatch = findFolderByNameInRoots(hint, deepRoots, 4, 3500);
  if (deepMatch) return deepMatch;

  return "";
}

function listDirectRecentEntries(folderPath = "", limit = 300) {
  if (!folderPath) return [];
  let rows = [];
  try {
    rows = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const items = [];
  for (const entry of rows) {
    if (!entry?.name || entry.name.startsWith(".")) continue;
    const fullPath = path.join(folderPath, entry.name);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    const ext = path.extname(entry.name || "").toLowerCase();
    const isDir = entry.isDirectory();
    const type = isDir ? "folder" : IMAGE_EXTS.has(ext) ? "image" : "document";
    const ts = stat.mtimeMs || stat.birthtimeMs || Date.now();
    items.push({
      name: entry.name,
      path: fullPath,
      type,
      sizeKB: isDir ? 0 : Math.max(0, Math.round((stat.size || 0) / 1024)),
      createdAt: new Date(ts).toISOString(),
      extractedText: "",
      score: 1,
      _recentRootOnly: true,
    });
  }

  return items
    .sort((a, b) => {
      const aTs = Date.parse(a.createdAt || 0) || 0;
      const bTs = Date.parse(b.createdAt || 0) || 0;
      return bTs - aTs;
    })
    .slice(0, limit);
}

function buildScopeMongoQuery(scopeFolders = []) {
  const folders = normalizeScopeFolders(scopeFolders);
  if (!folders.length) return {};

  const ors = folders.map((folder) => {
    const escaped = folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { path: new RegExp(`^${escaped}(?:[\\\\/]|$)`, "i") };
  });
  return ors.length === 1 ? ors[0] : { $or: ors };
}

function fuzzyScore(query, doc) {
  const qTokens = normalizeText(query);
  if (!qTokens.length) return 0;

  const haystack = `${doc?.name || ""} ${doc?.path || ""} ${doc?.extractedText || ""}`.toLowerCase();
  const hTokens = new Set(normalizeText(haystack));
  const hitCount = qTokens.filter((t) => hTokens.has(t) || haystack.includes(t)).length;
  const tokenScore = hitCount / qTokens.length;

  // Favor OCR-bearing matches for text queries.
  const textBonus = (doc?.extractedText || "").trim().length > 0 ? 0.08 : 0;
  return tokenScore + textBonus;
}

function shortText(value, max = 6000) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}...`;
}

function mergeExtractedText(...parts) {
  const rows = parts
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  if (!rows.length) return "";
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = row.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.join("\n\n").slice(0, 20000);
}

function normalizeHintToken(token = "") {
  return String(token || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .trim();
}

function parseJsonFromText(raw = "") {
  const txt = String(raw || "").trim();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {}

  const fenceMatch = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  const firstBrace = txt.indexOf("{");
  const lastBrace = txt.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(txt.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  return null;
}

function clipText(raw = "", max = 3500) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}...`;
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function hybridConfidence(doc = {}, queryText = "", queryTokens = []) {
  const q = String(queryText || "").toLowerCase().trim();
  const tokens = Array.isArray(queryTokens) && queryTokens.length
    ? queryTokens
    : tokenizeQuery(q);
  const hay = `${doc?.name || ""} ${doc?.path || ""} ${doc?.extractedText || ""}`
    .toLowerCase();
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];
  const tokenHits = uniqueTokens.filter((t) => hay.includes(t)).length;
  const lexical = uniqueTokens.length ? tokenHits / uniqueTokens.length : 0;
  const fuzzy = clamp01(fuzzyScore(q, doc));
  const semantic = clamp01(Number(doc?.semanticScore || 0));
  const exactPhrase = q && hay.includes(q) ? 0.1 : 0;
  const titleMatch = q && String(doc?.name || "").toLowerCase().includes(q) ? 0.08 : 0;
  const textPresence = String(doc?.extractedText || "").trim() ? 0.06 : 0;

  const score =
    lexical * 0.42 +
    fuzzy * 0.26 +
    semantic * 0.24 +
    exactPhrase +
    titleMatch +
    textPresence;
  return clamp01(score);
}

function docHaystack(doc = {}) {
  return `${doc?.name || ""} ${doc?.path || ""} ${doc?.extractedText || ""}`.toLowerCase();
}

function sanitizePublicId(raw = "") {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "")
    .slice(0, 120);
}

function xmlEscape(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function createSharePreviewJpegBuffer({
  filePath,
  suggestedName = "",
}) {
  const ext = path.extname(filePath || "").toLowerCase();
  if (IMAGE_EXTS.has(ext)) {
    return sharp(filePath).jpeg({ quality: 86 }).toBuffer();
  }

  const label = String(ext || "file").replace(".", "").toUpperCase() || "FILE";
  const titleRaw = suggestedName || path.basename(filePath || "") || "Shared file";
  const title = xmlEscape(titleRaw.slice(0, 80));
  const subtitle = xmlEscape(path.basename(filePath || "").slice(0, 88));

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#1e293b"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <rect x="80" y="90" width="1040" height="450" rx="24" fill="#111827" stroke="#334155" stroke-width="2"/>
    <rect x="120" y="130" width="180" height="62" rx="31" fill="#16a34a"/>
    <text x="210" y="171" fill="#ecfeff" font-size="30" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700">${xmlEscape(label)}</text>
    <text x="120" y="270" fill="#f8fafc" font-size="54" font-family="Arial, sans-serif" font-weight="700">${title}</text>
    <text x="120" y="335" fill="#cbd5e1" font-size="34" font-family="Arial, sans-serif">${subtitle}</text>
    <text x="120" y="505" fill="#86efac" font-size="28" font-family="Arial, sans-serif">Shared from Smart Screenshot Search</text>
  </svg>`;

  return sharp(Buffer.from(svg))
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

function cloudinarySignature(params, apiSecret) {
  const base = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(base + apiSecret).digest("hex");
}

function canUseCloudinaryShare() {
  if (!CLOUDINARY_CLOUD_NAME) return false;
  if (CLOUDINARY_UPLOAD_PRESET) return true; // preset flow
  return Boolean(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET); // signed flow
}

async function uploadImageToCloudinary({
  imagePath,
  sourceBuffer,
  suggestedName = "",
}) {
  if (!canUseCloudinaryShare()) {
    throw new Error("Cloud share is not configured.");
  }

  const jpegBuffer = sourceBuffer || (await createSharePreviewJpegBuffer({
    filePath: imagePath,
    suggestedName,
  }));
  const dataUri = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
    CLOUDINARY_CLOUD_NAME
  )}/image/upload`;

  const publicIdBase = sanitizePublicId(
    suggestedName || path.basename(imagePath, path.extname(imagePath))
  );
  const publicId = sanitizePublicId(
    `${publicIdBase || "share"}-${Date.now()}`
  );

  async function postCloudinary(params) {
    const resp = await axios.post(endpoint, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 45000,
    });
    const secureUrl = String(resp?.data?.secure_url || "").trim();
    if (!secureUrl) throw new Error("Cloudinary did not return secure_url.");
    return secureUrl;
  }

  // 1) Try preset flow first (commonly unsigned preset).
  if (CLOUDINARY_UPLOAD_PRESET) {
    const presetParams = new URLSearchParams();
    presetParams.set("file", dataUri);
    presetParams.set("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    try {
      return await postCloudinary(presetParams);
    } catch (presetErr) {
      const canTrySigned = Boolean(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
      if (!canTrySigned) {
        const cloudMsg =
          presetErr?.response?.data?.error?.message ||
          presetErr?.message ||
          "Preset upload failed.";
        throw new Error(`Cloudinary preset upload failed: ${cloudMsg}`);
      }
    }
  }

  // 2) Signed fallback (works even when preset flow is misconfigured).
  if (!(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET)) {
    throw new Error("Cloudinary signed credentials missing.");
  }

  const signedParams = new URLSearchParams();
  signedParams.set("file", dataUri);
  if (CLOUDINARY_FOLDER) signedParams.set("folder", CLOUDINARY_FOLDER);
  if (publicId) signedParams.set("public_id", publicId);
  const timestamp = Math.floor(Date.now() / 1000);
  const signPayload = { timestamp };
  if (CLOUDINARY_FOLDER) signPayload.folder = CLOUDINARY_FOLDER;
  if (publicId) signPayload.public_id = publicId;
  const signature = cloudinarySignature(signPayload, CLOUDINARY_API_SECRET);
  signedParams.set("timestamp", String(timestamp));
  signedParams.set("api_key", CLOUDINARY_API_KEY);
  signedParams.set("signature", signature);

  try {
    return await postCloudinary(signedParams);
  } catch (signedErr) {
    const cloudMsg =
      signedErr?.response?.data?.error?.message ||
      signedErr?.message ||
      "Signed upload failed.";
    throw new Error(`Cloudinary signed upload failed: ${cloudMsg}`);
  }
}

function guessMimeFromPath(filePath = "") {
  const ext = String(path.extname(filePath || "")).toLowerCase();
  const map = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
  };
  return map[ext] || "application/octet-stream";
}

async function uploadOriginalFileToCloudinary({
  filePath,
  suggestedName = "",
}) {
  if (!canUseCloudinaryShare()) {
    throw new Error("Cloud share is not configured.");
  }
  const fileBuffer = await fs.promises.readFile(filePath);
  const mime = guessMimeFromPath(filePath);
  const dataUri = `data:${mime};base64,${fileBuffer.toString("base64")}`;
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
    CLOUDINARY_CLOUD_NAME
  )}/auto/upload`;
  const publicIdBase = sanitizePublicId(
    suggestedName || path.basename(filePath, path.extname(filePath))
  );
  const publicId = sanitizePublicId(
    `${publicIdBase || "share-file"}-${Date.now()}`
  );

  async function postCloudinary(params) {
    const resp = await axios.post(endpoint, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 60000,
    });
    const secureUrl = String(resp?.data?.secure_url || "").trim();
    if (!secureUrl) throw new Error("Cloudinary did not return secure_url.");
    return secureUrl;
  }

  if (CLOUDINARY_UPLOAD_PRESET) {
    const presetParams = new URLSearchParams();
    presetParams.set("file", dataUri);
    presetParams.set("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    if (CLOUDINARY_FOLDER) presetParams.set("folder", CLOUDINARY_FOLDER);
    try {
      return await postCloudinary(presetParams);
    } catch (presetErr) {
      const canTrySigned = Boolean(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
      if (!canTrySigned) {
        const cloudMsg =
          presetErr?.response?.data?.error?.message ||
          presetErr?.message ||
          "Preset upload failed.";
        throw new Error(`Cloudinary preset upload failed: ${cloudMsg}`);
      }
    }
  }

  if (!(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET)) {
    throw new Error("Cloudinary signed credentials missing.");
  }

  const signedParams = new URLSearchParams();
  signedParams.set("file", dataUri);
  if (CLOUDINARY_FOLDER) signedParams.set("folder", CLOUDINARY_FOLDER);
  if (publicId) signedParams.set("public_id", publicId);
  const timestamp = Math.floor(Date.now() / 1000);
  const signPayload = { timestamp };
  if (CLOUDINARY_FOLDER) signPayload.folder = CLOUDINARY_FOLDER;
  if (publicId) signPayload.public_id = publicId;
  const signature = cloudinarySignature(signPayload, CLOUDINARY_API_SECRET);
  signedParams.set("timestamp", String(timestamp));
  signedParams.set("api_key", CLOUDINARY_API_KEY);
  signedParams.set("signature", signature);

  try {
    return await postCloudinary(signedParams);
  } catch (signedErr) {
    const cloudMsg =
      signedErr?.response?.data?.error?.message ||
      signedErr?.message ||
      "Signed upload failed.";
    throw new Error(`Cloudinary signed upload failed: ${cloudMsg}`);
  }
}

function semanticTextForDoc(doc = {}) {
  return clipText(`${doc.name || ""}\n${doc.extractedText || ""}\n${doc.path || ""}`, 3500);
}

function isValidVector(v) {
  return Array.isArray(v) && v.length > 8 && v.every((n) => Number.isFinite(n));
}

function cosineSimilarity(a = [], b = []) {
  if (!isValidVector(a) || !isValidVector(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const CLIP_TEXT_CACHE = new Map();
const CLIP_TEXT_CACHE_MAX = 200;

async function getClipTextEmbedding(text = "") {
  const clean = String(text || "").trim();
  if (!clean || clean.length < CLIP_MIN_CHARS) return [];
  const cacheKey = `${CLIP_MODEL}:${CLIP_PRETRAINED}:${clean}`;
  if (CLIP_TEXT_CACHE.has(cacheKey)) return CLIP_TEXT_CACHE.get(cacheKey);

  try {
    const resp = await axios.post(
      `${LOCAL_VISION_URL}/embed-text`,
      { text: clean, model: CLIP_MODEL, pretrained: CLIP_PRETRAINED },
      { timeout: CLIP_TIMEOUT_MS }
    );
    const vec = resp?.data?.vector || [];
    if (isValidVector(vec)) {
      CLIP_TEXT_CACHE.set(cacheKey, vec);
      if (CLIP_TEXT_CACHE.size > CLIP_TEXT_CACHE_MAX) {
        const firstKey = CLIP_TEXT_CACHE.keys().next().value;
        if (firstKey) CLIP_TEXT_CACHE.delete(firstKey);
      }
      return vec;
    }
  } catch {}
  return [];
}

async function getClipImageEmbedding(filePath = "") {
  const p = String(filePath || "").trim();
  if (!p || !fs.existsSync(p)) return [];
  try {
    const form = new FormData();
    form.append("image", fs.createReadStream(p));
    form.append("model", CLIP_MODEL);
    form.append("pretrained", CLIP_PRETRAINED);
    const resp = await axios.post(`${LOCAL_VISION_URL}/embed-image`, form, {
      headers: form.getHeaders(),
      timeout: CLIP_TIMEOUT_MS,
    });
    const vec = resp?.data?.vector || [];
    return isValidVector(vec) ? vec : [];
  } catch {
    return [];
  }
}

async function embedTexts(texts = []) {
  assertAiNotRateLimited();
  const clean = texts.map((t) => clipText(t, 3500));
  if (!clean.length) return [];

  if (LLM_PROVIDER === "gemini") {
    if (!GEMINI_API_KEY) throw new Error("Gemini key missing for semantic search.");
    const vectors = [];
    for (const t of clean) {
      let resp;
      try {
        resp = await axios.post(
          `${GEMINI_BASE_URL}/models/${encodeURIComponent(AI_SEMANTIC_MODEL)}:embedContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
          {
            content: { parts: [{ text: t }] },
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: AI_SEMANTIC_TIMEOUT_MS,
          }
        );
      } catch (err) {
        markAiRateLimited(err);
        throw err;
      }
      vectors.push(resp?.data?.embedding?.values || []);
    }
    return vectors;
  }

  if (!OPENAI_API_KEY) throw new Error("OpenAI key missing for semantic search.");
  let resp;
  try {
    resp = await axios.post(
      `${OPENAI_BASE_URL}/embeddings`,
      {
        model: AI_SEMANTIC_MODEL,
        input: clean,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: AI_SEMANTIC_TIMEOUT_MS,
      }
    );
  } catch (err) {
    markAiRateLimited(err);
    throw err;
  }
  const rows = Array.isArray(resp?.data?.data) ? resp.data.data : [];
  return rows.map((r) => r?.embedding || []);
}

async function applySemanticRerank(docs = [], queryText = "") {
  if (!AI_SEMANTIC_SEARCH || !queryText || !docs.length) {
    return { docs, meta: { enabled: AI_SEMANTIC_SEARCH, applied: false } };
  }

  const selected = docs.slice(0, Math.max(1, AI_SEMANTIC_MAX_CANDIDATES));
  try {
    const [qVec] = await embedTexts([queryText]);
    if (!isValidVector(qVec)) {
      return { docs, meta: { enabled: true, applied: false, reason: "query_embedding_invalid" } };
    }

    const needs = [];
    const missingIdx = [];
    selected.forEach((d, i) => {
      const hasCached = isValidVector(d.semanticVector) && String(d.semanticModel || "") === AI_SEMANTIC_MODEL;
      if (!hasCached) {
        needs.push(semanticTextForDoc(d));
        missingIdx.push(i);
      }
    });

    if (needs.length) {
      const vecs = await embedTexts(needs);
      await Promise.all(
        vecs.map(async (vec, j) => {
          const i = missingIdx[j];
          const doc = selected[i];
          if (!doc?._id || !isValidVector(vec)) return;
          doc.semanticVector = vec;
          doc.semanticModel = AI_SEMANTIC_MODEL;
          try {
            await IndexedFileModel.updateOne(
              { _id: doc._id },
              { $set: { semanticVector: vec, semanticModel: AI_SEMANTIC_MODEL } }
            );
          } catch {}
        })
      );
    }

    const rescored = docs.map((d, idx) => {
      const local = idx < selected.length ? selected[idx] : d;
      const sim = isValidVector(local.semanticVector) ? cosineSimilarity(qVec, local.semanticVector) : 0;
      const semanticScore = Math.max(0, Math.min(1, (sim + 1) / 2));
      const baseRank = docs.length > 1 ? 1 - idx / (docs.length - 1) : 1;
      const blended = semanticScore * 0.68 + baseRank * 0.32;
      return {
        ...d,
        semanticScore,
        score: Number(d.score || 0) + blended,
      };
    });

    rescored.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return {
      docs: rescored,
      meta: {
        enabled: true,
        applied: true,
        model: AI_SEMANTIC_MODEL,
        reranked: rescored.length,
      },
    };
  } catch (err) {
    return {
      docs,
      meta: {
        enabled: true,
        applied: false,
        reason: err?.message || "semantic_failed",
      },
    };
  }
}

async function applyClipImageRerank(docs = [], queryText = "") {
  if (!CLIP_IMAGE_RERANK_ENABLED) {
    return { docs, meta: { enabled: false, applied: false } };
  }

  const cleanQuery = String(queryText || "").trim();
  if (!cleanQuery || cleanQuery.length < CLIP_MIN_CHARS) {
    return { docs, meta: { enabled: true, applied: false, reason: "query_too_short" } };
  }

  const qVec = await getClipTextEmbedding(cleanQuery);
  if (!isValidVector(qVec)) {
    return { docs, meta: { enabled: true, applied: false, reason: "embed_failed" } };
  }

  const imageDocs = docs.filter((d) => d?.type === "image");
  if (!imageDocs.length) {
    return { docs, meta: { enabled: true, applied: false, reason: "no_images" } };
  }

  const candidates = imageDocs.slice(0, CLIP_MAX_CANDIDATES);
  const missingIds = candidates
    .filter((d) => d?._id && !isValidVector(d.imageVector))
    .map((d) => d._id);

  if (missingIds.length && IndexedFileModel) {
    try {
      const rows = await IndexedFileModel.find(
        { _id: { $in: missingIds } },
        { imageVector: 1, imageModel: 1 }
      ).lean();
      const map = new Map(rows.map((r) => [String(r._id), r]));
      for (const d of candidates) {
        const row = map.get(String(d._id));
        if (row && isValidVector(row.imageVector)) {
          d.imageVector = row.imageVector;
          d.imageModel = row.imageModel || "";
        }
      }
    } catch {}
  }

  let reranked = 0;
  const rescored = docs.map((d) => {
    if (d?.type !== "image") return d;
    if (!isValidVector(d.imageVector)) return d;
    if (d.imageModel && d.imageModel !== CLIP_MODEL) return d;
    const sim = cosineSimilarity(qVec, d.imageVector);
    const clipScore = Math.max(0, Math.min(1, (sim + 1) / 2));
    reranked += 1;
    return {
      ...d,
      clipScore,
      score: Number(d?.score || 0) + clipScore * 0.45,
    };
  });

  rescored.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return {
    docs: rescored,
    meta: { enabled: true, applied: reranked > 0, reranked, model: CLIP_MODEL },
  };
}

async function generateTextWithProvider({
  systemPrompt,
  userPrompt,
  temperature = 0.2,
  timeoutMs = 60000,
}) {
  assertAiNotRateLimited();
  const maxRetries = 3;
  const textModel = getPrimaryLlmModel();

  if (LLM_PROVIDER === "gemini") {
    if (!GEMINI_API_KEY) {
      throw new Error("Gemini key missing. Set GEMINI_API_KEY in backend_node/.env");
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const resp = await axios.post(
          `${GEMINI_BASE_URL}/models/${encodeURIComponent(textModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
          {
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: userPrompt }],
              },
            ],
            generationConfig: {
              temperature,
            },
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
            timeout: timeoutMs,
          }
        );

        const parts = resp?.data?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          return parts.map((p) => p?.text || "").join("\n").trim();
        }
        return "";
      } catch (err) {
        markAiRateLimited(err);
        throw err;
      }
    }
  }

  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI key missing. Set OPENAI_API_KEY or LLM_API_KEY in backend_node/.env");
  }

  const modelCandidates = getOpenAiModelCandidates();
  let lastError = null;

  for (const model of modelCandidates) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const resp = await axios.post(
          `${OPENAI_BASE_URL}/chat/completions`,
          {
            model,
            temperature,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: timeoutMs,
          }
        );

        return (
          resp?.data?.choices?.[0]?.message?.content ||
          resp?.data?.choices?.[0]?.text ||
          ""
        );
      } catch (err) {
        lastError = err;
        if (err?.response?.status === 404 && model !== modelCandidates[modelCandidates.length - 1]) {
          console.warn(`OpenAI model "${model}" unavailable; retrying with fallback.`);
          break;
        }
        markAiRateLimited(err);
        throw err;
      }
    }
  }

  throw lastError || new Error("OpenAI text generation failed");
}

async function askLlmAboutFile({ question, fileContext }) {
  const systemPrompt =
    "You answer questions about one selected local file. Use only provided context. If uncertain, say what is missing. Keep answers concise and practical.";

  const userPrompt = [
    `Question: ${question}`,
    "File context:",
    `- Name: ${fileContext.name || ""}`,
    `- Type: ${fileContext.type || ""}`,
    `- Path: ${fileContext.path || ""}`,
    `- OCR/Text: ${shortText(fileContext.extractedText || "", 5000) || "No OCR text available."}`,
  ].join("\n");

  return generateTextWithProvider({ systemPrompt, userPrompt, temperature: 0.2 });
}

function getCachedQueryHints(key) {
  if (!QUERY_HINT_CACHE.has(key)) return null;
  return QUERY_HINT_CACHE.get(key);
}

function setCachedQueryHints(key, value) {
  QUERY_HINT_CACHE.set(key, value);
  if (QUERY_HINT_CACHE.size > QUERY_HINT_CACHE_MAX) {
    const firstKey = QUERY_HINT_CACHE.keys().next().value;
    if (firstKey) QUERY_HINT_CACHE.delete(firstKey);
  }
}

async function getAiQueryHints(rawQuery = "") {
  const query = String(rawQuery || "").trim();
  if (!AI_QUERY_ASSIST || query.length < AI_QUERY_MIN_CHARS) {
    return { rewrittenQuery: "", keywords: [] };
  }

  const cacheKey = query.toLowerCase();
  const cached = getCachedQueryHints(cacheKey);
  if (cached) return cached;

  const systemPrompt =
    "You improve desktop file-search queries. Return STRICT JSON only with keys: rewrittenQuery (string), keywords (array of up to 8 short strings).";
  const userPrompt = [
    `User query: ${query}`,
    "Rewrite for better file/document/image retrieval. Fix spelling and add related search terms.",
    "Do not explain. Output JSON only.",
  ].join("\n");

  const raw = await generateTextWithProvider({
    systemPrompt,
    userPrompt,
    temperature: 0,
    timeoutMs: AI_QUERY_TIMEOUT_MS,
  });
  const parsed = parseJsonFromText(raw) || {};
  const rewrittenQuery = String(parsed.rewrittenQuery || "").trim();
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords
        .map((k) => normalizeHintToken(k))
        .filter(Boolean)
        .flatMap((k) => k.split(/\s+/))
        .map((k) => normalizeHintToken(k))
        .filter(Boolean)
    : [];

  const deduped = [...new Set(keywords)].slice(0, 12);
  const hints = { rewrittenQuery, keywords: deduped };
  setCachedQueryHints(cacheKey, hints);
  return hints;
}

async function applyLlmQueryRerank(docs = [], queryText = "") {
  if (!AI_LLM_RERANK_ENABLED || !queryText || !docs.length) {
    return { docs, meta: { enabled: AI_LLM_RERANK_ENABLED, applied: false } };
  }

  try {
    const selected = docs.slice(0, Math.max(1, AI_LLM_RERANK_MAX_CANDIDATES));
    const compact = selected.map((d, idx) => ({
      idx,
      name: String(d?.name || ""),
      type: String(d?.type || ""),
      path: String(d?.path || ""),
      text: shortText(String(d?.extractedText || ""), 280),
    }));

    const systemPrompt =
      "You rank desktop search candidates for a user query. Use exact match, fuzzy match, and semantic visual/text match. Return strict JSON only.";
    const userPrompt = [
      `Query: ${queryText}`,
      "Candidates JSON:",
      JSON.stringify(compact),
      'Output JSON format: {"ranked":[{"idx":0,"score":0.0}]}',
      "Rules: score is 0..1, higher is better, include only candidates that are relevant.",
    ].join("\n");

    const raw = await generateTextWithProvider({
      systemPrompt,
      userPrompt,
      temperature: 0,
      timeoutMs: AI_LLM_RERANK_TIMEOUT_MS,
    });
    const parsed = parseJsonFromText(raw) || {};
    const ranked = Array.isArray(parsed?.ranked) ? parsed.ranked : [];
    if (!ranked.length) {
      return {
        docs,
        meta: { enabled: true, applied: false, reason: "empty_ranked" },
      };
    }

    const llmScoreByIdx = new Map();
    ranked.forEach((r) => {
      const idx = Number(r?.idx);
      const score = clamp01(Number(r?.score));
      if (!Number.isInteger(idx) || idx < 0 || idx >= selected.length) return;
      llmScoreByIdx.set(idx, score);
    });

    const rescoredTop = selected.map((d, idx) => {
      const llmScore = llmScoreByIdx.has(idx) ? llmScoreByIdx.get(idx) : 0;
      return {
        ...d,
        llmScore,
        score: Number(d?.score || 0) + llmScore * 0.9,
      };
    });
    rescoredTop.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    const tail = docs.slice(selected.length);
    return {
      docs: [...rescoredTop, ...tail],
      meta: {
        enabled: true,
        applied: true,
        reranked: rescoredTop.length,
      },
    };
  } catch (err) {
    return {
      docs,
      meta: {
        enabled: true,
        applied: false,
        reason: err?.message || "llm_rerank_failed",
      },
    };
  }
}

async function upsertIndexedFile({
  logicalPath,
  physicalPath,
  sizeKB,
  sizeBytes,
  mtimeMs,
  ext,
}) {
  const pathKey = normalizePathKey(logicalPath);
  const existingRows = await IndexedFileModel.find({
    $or: [{ pathKey }, { path: logicalPath }],
  })
    .select(
      "_id extractedText sizeKB sourceSizeBytes sourceMtimeMs pathKey updatedAt fileHash imageHash imageVector imageModel"
    )
    .sort({ updatedAt: -1 })
    .lean();

  const existing = existingRows?.[0] || null;
  if (existingRows?.length > 1) {
    const dupIds = existingRows.slice(1).map((row) => row._id);
    if (dupIds.length) {
      await IndexedFileModel.deleteMany({ _id: { $in: dupIds } });
    }
  }

  const nextSizeKB = Math.round(sizeKB || 0);
  const hasStableSignature =
    typeof sizeBytes === "number" && typeof mtimeMs === "number";

  const unchangedBySignature =
    hasStableSignature &&
    existing &&
    existing.sourceSizeBytes === sizeBytes &&
    existing.sourceMtimeMs === mtimeMs;

  // Legacy fallback for old records that don't have source signature yet.
  const unchangedByLegacyHeuristic =
    existing &&
    (existing.sourceSizeBytes == null || existing.sourceMtimeMs == null) &&
    existing.sizeKB === nextSizeKB &&
    Boolean((existing.extractedText || "").trim());

  const isImage = IMAGE_EXTS.has(ext);
  const hasExistingText = Boolean((existing?.extractedText || "").trim());

  if (existing && OCR_SKIP_IF_EXISTS && hasExistingText) {
    const updatePayload = {
      name: path.basename(logicalPath),
      path: logicalPath,
      pathKey,
      sizeKB: nextSizeKB,
      type: isImage ? "image" : "document",
      sourceSizeBytes:
        typeof sizeBytes === "number" ? sizeBytes : existing.sourceSizeBytes,
      sourceMtimeMs:
        typeof mtimeMs === "number" ? mtimeMs : existing.sourceMtimeMs,
    };

    const needFileHash = !existing.fileHash && physicalPath;
    if (needFileHash) {
      try {
        updatePayload.fileHash = await computeFileHash(physicalPath);
      } catch {}
    }

    const needImageHash = isImage && !existing.imageHash && physicalPath;
    if (needImageHash) {
      try {
        updatePayload.imageHash = await computeDhash(physicalPath);
      } catch {}
    }

    const needsImageVector =
      isImage &&
      CLIP_IMAGE_RERANK_ENABLED &&
      (!isValidVector(existing.imageVector) || existing.imageModel !== CLIP_MODEL);
    if (needsImageVector && physicalPath) {
      const vec = await getClipImageEmbedding(physicalPath);
      if (isValidVector(vec)) {
        updatePayload.imageVector = vec;
        updatePayload.imageModel = CLIP_MODEL;
      }
    }

    await IndexedFileModel.updateOne({ _id: existing._id }, { $set: updatePayload });
    return;
  }
  if (existing && (unchangedBySignature || unchangedByLegacyHeuristic)) {
    const updatePayload = {
      name: path.basename(logicalPath),
      path: logicalPath,
      pathKey,
      sizeKB: nextSizeKB,
      type: isImage ? "image" : "document",
      sourceSizeBytes:
        typeof sizeBytes === "number" ? sizeBytes : existing.sourceSizeBytes,
      sourceMtimeMs:
        typeof mtimeMs === "number" ? mtimeMs : existing.sourceMtimeMs,
    };

    const needFileHash = !existing.fileHash && physicalPath;
    if (needFileHash) {
      try {
        updatePayload.fileHash = await computeFileHash(physicalPath);
      } catch {}
    }

    const needImageHash = isImage && !existing.imageHash && physicalPath;
    if (needImageHash) {
      try {
        updatePayload.imageHash = await computeDhash(physicalPath);
      } catch {}
    }

    // Keep metadata fresh but skip OCR for unchanged files.
    await IndexedFileModel.updateOne({ _id: existing._id }, { $set: updatePayload });
    return;
  }

  const text = await extractTextSafe(physicalPath);
  let semanticImageText = "";
  if (isImage && OPEN_VOCAB_IMAGE_INDEX) {
    try {
      semanticImageText = await describeImageSemanticSafe(physicalPath, {
        prompt:
          "Describe this image for search with keywords about people, clothing, colors, objects, scene, and visible text.",
      });
    } catch {}
  }

  const resolvedText = mergeExtractedText(
    text,
    semanticImageText,
    existing?.extractedText || ""
  );

  // File hash is computed for all files (images + documents) for duplicate detection.
  let fileHash = existing?.fileHash || null;
  let imageHash = existing?.imageHash || null;
  let imageVector = existing?.imageVector || null;
  let imageModel = existing?.imageModel || "";
  if (!fileHash && physicalPath) {
    try {
      fileHash = await computeFileHash(physicalPath);
    } catch {}
  }

  if (isImage && physicalPath && !imageHash) {
    try {
      imageHash = await computeDhash(physicalPath);
    } catch {}
  }

  if (
    isImage &&
    physicalPath &&
    CLIP_IMAGE_RERANK_ENABLED &&
    (!isValidVector(imageVector) || imageModel !== CLIP_MODEL)
  ) {
    const vec = await getClipImageEmbedding(physicalPath);
    if (isValidVector(vec)) {
      imageVector = vec;
      imageModel = CLIP_MODEL;
    }
  }

  const payload = {
    name: path.basename(logicalPath),
    path: logicalPath,
    pathKey,
    extractedText: resolvedText,
    sizeKB: nextSizeKB,
    type: isImage ? "image" : "document",
    sourceSizeBytes: typeof sizeBytes === "number" ? sizeBytes : null,
    sourceMtimeMs: typeof mtimeMs === "number" ? mtimeMs : null,
    fileHash,
    imageHash,
    imageVector,
    imageModel,
  };

  if (existing?._id) {
    await IndexedFileModel.updateOne({ _id: existing._id }, { $set: payload });
    return;
  }

  // Atomic upsert avoids duplicate key races when watcher emits rapid same-path events.
  try {
    await IndexedFileModel.updateOne(
      { $or: [{ pathKey }, { path: logicalPath }] },
      { $set: payload },
      { upsert: true }
    );
  } catch (err) {
    // On rare duplicate-key races, retry using the literal path as filter.
    if (String(err?.message || "").includes("E11000")) {
      await IndexedFileModel.updateOne(
        { path: logicalPath },
        { $set: payload },
        { upsert: true }
      );
    } else {
      throw err;
    }
  }
}

async function removeIndexedFileByPath(logicalPath = "") {
  const p = String(logicalPath || "").trim();
  if (!p || !IndexedFileModel) return 0;
  const pathKey = normalizePathKey(p);
  const result = await IndexedFileModel.deleteMany({
    $or: [{ pathKey }, { path: p }],
  });
  return Number(result?.deletedCount || 0);
}

function countEligibleFiles(dir) {
  let total = 0;
  let entries;

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      total += countEligibleFiles(fullPath);
      continue;
    }

    try {
      if (!shouldIndexFile(fullPath)) continue;
      const stat = fs.statSync(fullPath);
      if (!stat.size) continue;
      total++;
    } catch {}
  }

  return total;
}

function clearDirectoryFiles(dirPath = "") {
  if (!dirPath) return 0;
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const rows = fs.readdirSync(dirPath);
    let deleted = 0;
    for (const name of rows) {
      const full = path.join(dirPath, name);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
        } else {
          fs.unlinkSync(full);
        }
        deleted += 1;
      } catch {}
    }
    return deleted;
  } catch {
    return 0;
  }
}

router.post("/cancel-index", (_, res) => {
  if (!INDEXING_STATE.running) {
    return res.json({ ok: true, running: false, canceled: false });
  }

  INDEXING_STATE.cancelRequested = true;
  sendProgress("Stop requested. Cancelling indexing...", "canceling");
  return res.json({ ok: true, running: true, canceled: true });
});

router.post("/reset-app", async (req, res) => {
  try {
    const confirmText = String(req.body?.confirm || "").trim().toUpperCase();
    if (confirmText !== "RESET_APP") {
      return res.status(400).json({
        ok: false,
        error: "Confirmation required.",
      });
    }

    INDEXING_STATE.cancelRequested = true;

    const deleted = {
      indexedFiles: 0,
      savedItems: 0,
      history: 0,
      searches: 0,
      uploads: 0,
      thumbnails: 0,
    };

    if (IndexedFileModel) {
      const result = await IndexedFileModel.deleteMany({});
      deleted.indexedFiles = Number(result?.deletedCount || 0);
    }
    if (SavedItemModel) {
      const result = await SavedItemModel.deleteMany({});
      deleted.savedItems = Number(result?.deletedCount || 0);
    }
    if (HistoryModel) {
      const result = await HistoryModel.deleteMany({});
      deleted.history = Number(result?.deletedCount || 0);
    }
    if (SearchModel) {
      const result = await SearchModel.deleteMany({});
      deleted.searches = Number(result?.deletedCount || 0);
    }

    deleted.uploads = clearDirectoryFiles(path.join(process.cwd(), "uploads"));
    deleted.thumbnails = clearDirectoryFiles(
      path.join(process.cwd(), "backend_node", "thumb_cache")
    );

    sendProgress("Ready for a fresh start.", "idle");
    return res.json({ ok: true, deleted });
  } catch (err) {
    console.error("Reset app failed:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: "Could not reset app data.",
    });
  } finally {
    INDEXING_STATE.running = false;
    INDEXING_STATE.cancelRequested = false;
  }
});

/* =======================================================
   🌐 POST /api/search/index-upload
======================================================= */
router.post(
  "/index-upload",
  upload.array("files", 500),
  async (req, res) => {
    if (INDEXING_STATE.running) {
      return res.status(409).json({
        ok: false,
        error: "Indexing already in progress",
      });
    }

    if (!req.files?.length || !IndexedFileModel) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    res.json({ ok: true });

  setImmediate(async () => {
    INDEXING_STATE.running = true;
    INDEXING_STATE.cancelRequested = false;
    const total = req.files.length;
    let done = 0;

    try {
      sendProgress(`Indexing started (0/${total})`, "working");

      for (const f of req.files) {
        if (INDEXING_STATE.cancelRequested) break;
        done++;

        try {
          if (!f?.path || !fs.existsSync(f.path)) continue;

          const logicalPath = f.originalname;
          const ext = path.extname(logicalPath).toLowerCase();

          await upsertIndexedFile({
            logicalPath,
            physicalPath: f.path,
            sizeKB: f.size / 1024,
            sizeBytes: f.size,
            mtimeMs: fs.statSync(f.path).mtimeMs,
            ext,
          });
        } catch {}

        sendProgress(`Processed ${done}/${total}`, "working");
      }

      const indexedCount = await IndexedFileModel.countDocuments();
      if (INDEXING_STATE.cancelRequested) {
        sendProgress(
          `Indexing canceled. Processed files: ${done}/${total}. Saved in DB: ${indexedCount}`,
          "canceled"
        );
      } else {
        sendProgress(
          `Indexing completed. Total files processed: ${done}/${total}. Saved in DB: ${indexedCount}`,
          "done"
        );
      }
    } catch (err) {
      console.error("index-upload failed:", err);
      sendProgress("Indexing failed. Please try again.", "error");
    } finally {
      INDEXING_STATE.running = false;
      INDEXING_STATE.cancelRequested = false;
    }
  });
  }
);

/* =======================================================
   🖥️ POST /api/search/index-folders
======================================================= */
router.post("/index-folders", async (req, res) => {
  if (INDEXING_STATE.running) {
    return res.status(409).json({
      ok: false,
      error: "Indexing already in progress",
    });
  }

  const { folders = [] } = req.body || {};
  if (!folders.length) return res.json({ ok: false });

  res.json({ ok: true });

  setImmediate(async () => {
    INDEXING_STATE.running = true;
    INDEXING_STATE.cancelRequested = false;
    const total = folders.reduce((acc, root) => acc + countEligibleFiles(root), 0);
    const state = { done: 0, total };

    try {
      sendProgress(`Indexing started (0/${total || 0})`, "working");

      for (const root of folders) {
        if (INDEXING_STATE.cancelRequested) break;
        await scanRecursive(root, state);
      }

      const indexedCount = await IndexedFileModel.countDocuments();
      if (INDEXING_STATE.cancelRequested) {
        sendProgress(
          `Indexing canceled. Processed files: ${state.done}/${state.total || state.done}. Saved in DB: ${indexedCount}`,
          "canceled"
        );
      } else {
        sendProgress(
          `Indexing completed. Total files processed: ${state.done}/${state.total || state.done}. Saved in DB: ${indexedCount}`,
          "done"
        );
      }
    } catch (err) {
      console.error("index-folders failed:", err);
      sendProgress("Indexing failed. Please try again.", "error");
    } finally {
      INDEXING_STATE.running = false;
      INDEXING_STATE.cancelRequested = false;
    }
  });
});

router.post("/sync-file", async (req, res) => {
  try {
    if (!IndexedFileModel) {
      return res.status(500).json({ ok: false, error: "Index unavailable" });
    }
    const rawPath = String(req.body?.path || "").trim();
    const allowedFolders = normalizeScopeFolders(req.body?.allowedFolders || []);
    if (!rawPath) {
      return res.status(400).json({ ok: false, error: "Path is required." });
    }
    if (!isPathWithinFolders(rawPath, allowedFolders)) {
      return res.status(403).json({ ok: false, error: "Path is outside allowed folders." });
    }
    if (!fs.existsSync(rawPath)) {
      const deletedCount = await removeIndexedFileByPath(rawPath);
      return res.json({ ok: true, deleted: deletedCount, skipped: true });
    }

    const stat = fs.statSync(rawPath);
    if (!stat.isFile() || !stat.size) {
      return res.json({ ok: true, skipped: true });
    }
    if (!shouldIndexFile(rawPath)) {
      return res.json({ ok: true, skipped: true });
    }

    const ext = path.extname(rawPath).toLowerCase();
    await upsertIndexedFile({
      logicalPath: rawPath,
      physicalPath: rawPath,
      sizeKB: stat.size / 1024,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      ext,
    });

    return res.json({ ok: true, indexed: true, path: rawPath });
  } catch (err) {
    console.error("sync-file failed:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Incremental sync failed." });
  }
});

router.post("/sync-delete", async (req, res) => {
  try {
    if (!IndexedFileModel) {
      return res.status(500).json({ ok: false, error: "Index unavailable" });
    }
    const rawPath = String(req.body?.path || "").trim();
    const allowedFolders = normalizeScopeFolders(req.body?.allowedFolders || []);
    if (!rawPath) {
      return res.status(400).json({ ok: false, error: "Path is required." });
    }
    if (!isPathWithinFolders(rawPath, allowedFolders)) {
      return res.status(403).json({ ok: false, error: "Path is outside allowed folders." });
    }
    const deletedCount = await removeIndexedFileByPath(rawPath);
    return res.json({ ok: true, deleted: deletedCount });
  } catch (err) {
    console.error("sync-delete failed:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Delete sync failed." });
  }
});

/* =========================
   🔁 Recursive scanner
========================= */
async function scanRecursive(dir, progressState) {
  if (INDEXING_STATE.cancelRequested) return;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (INDEXING_STATE.cancelRequested) break;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      await scanRecursive(fullPath, progressState);
    } else {
      try {
        if (!shouldIndexFile(fullPath)) continue;
        const stat = fs.statSync(fullPath);
        if (!stat.size) continue;

        const ext = path.extname(fullPath).toLowerCase();

        await upsertIndexedFile({
          logicalPath: fullPath,
          physicalPath: fullPath,
          sizeKB: stat.size / 1024,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
          ext,
        });

        if (progressState) {
          progressState.done += 1;
          sendProgress(
            `Processed ${progressState.done}/${progressState.total || progressState.done}`,
            "working"
          );
        }
      } catch {}
    }
  }
}

/* =======================================================
   🔍 POST /api/search
======================================================= */
router.post("/", async (req, res) => {
  try {
    const { query = "", scopeFolders = [] } = req.body || {};
    const cleanQuery = query.trim();
    if (!cleanQuery) return res.json({ files: [], top5: [] });
    const scopeQuery = buildScopeMongoQuery(scopeFolders);

    const recentIntent = extractRecentFolderIntent(cleanQuery);
    if (recentIntent) {
      const folderPath = resolveFolderFromHint(recentIntent.folderHint, scopeFolders);
      if (folderPath) {
        const files = listDirectRecentEntries(folderPath, 300);
        return res.json({
          files,
          top5: files.filter((f) => f.type === "image").slice(0, 5),
        });
      }
    }

    // Intent shortcut: "find duplicates" should work even when OCR/name text
    // doesn't contain the keyword.
    if (isDuplicateIntent(cleanQuery)) {
      const dupPipeline = [];
      if (Object.keys(scopeQuery).length) dupPipeline.push({ $match: scopeQuery });
      dupPipeline.push(
        { $match: { fileHash: { $exists: true, $ne: null } } },
        { $group: { _id: "$fileHash", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 500 }
      );
      const dupGroups = await IndexedFileModel.aggregate(dupPipeline);

      const hashToCount = new Map(dupGroups.map((g) => [g._id, g.count]));
      const hashes = dupGroups.map((g) => g._id);
      if (!hashes.length) return res.json({ files: [], top5: [] });

      const docs = await IndexedFileModel.find(
        combineQueries(scopeQuery, { fileHash: { $in: hashes } })
      )
        .sort({ updatedAt: -1 })
        .limit(2000)
        .lean();

      const ranked = docs
        .map((d) => ({
          ...d,
          score: (hashToCount.get(d.fileHash) || 1) / 10,
          _dupCount: hashToCount.get(d.fileHash) || 1,
        }))
        .sort((a, b) => {
          const aCount = a._dupCount || 1;
          const bCount = b._dupCount || 1;
          if (bCount !== aCount) return bCount - aCount;
          const aTs = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
          const bTs = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
          return bTs - aTs;
        });

      return res.json({
        files: ranked,
        top5: ranked.slice(0, 5),
      });
    }

    const baseTokens = tokenizeQuery(cleanQuery);
    let aiHints = { rewrittenQuery: "", keywords: [] };
    if (!isDuplicateIntent(cleanQuery)) {
      try {
        aiHints = await getAiQueryHints(cleanQuery);
      } catch (err) {
        console.warn("AI query assist skipped:", err?.message || err);
      }
    }

    const expandedTokens = [
      ...baseTokens,
      ...tokenizeQuery(aiHints.rewrittenQuery || ""),
      ...((aiHints.keywords || []).flatMap((k) => tokenizeQuery(k))),
    ];
    const tokens = expandIntentTokens(expandedTokens, cleanQuery);
    const expandedQuery = [cleanQuery, aiHints.rewrittenQuery || "", (aiHints.keywords || []).join(" ")]
      .join(" ")
      .trim();
    const candidates = new Map();
    const pushCandidates = (rows = [], sourceBoost = 0) => {
      for (const row of rows) {
        const key = String(row?._id || row?.path || "");
        if (!key) continue;
        const current = candidates.get(key);
        const nextScore = Number(row?.score || 0) + sourceBoost;
        if (!current) {
          candidates.set(key, {
            ...row,
            score: nextScore,
          });
          continue;
        }
        candidates.set(key, {
          ...current,
          ...row,
          score: Math.max(Number(current.score || 0), nextScore),
        });
      }
    };

    // 1) Mongo full-text
    try {
      const textDocs = await IndexedFileModel.find(
        combineQueries(scopeQuery, { $text: { $search: expandedQuery || cleanQuery } }),
        { score: { $meta: "textScore" } }
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(360)
        .lean();
      pushCandidates(textDocs, 0.35);
    } catch {}

    // 2) Exact token contains on filename/path/content
    if (tokens.length) {
      try {
        const regexDocs = await IndexedFileModel.find(
          combineQueries(scopeQuery, buildRegexAndQuery(tokens))
        )
          .sort({ updatedAt: -1 })
          .limit(450)
          .lean();
        const scoredRegex = regexDocs.map((d) => ({
          ...d,
          score: fuzzyScore(expandedQuery || cleanQuery, d) + 0.25,
        }));
        pushCandidates(scoredRegex, 0.2);
      } catch {}
    }

    // 3) Fuzzy scan for typo tolerance and partial matches
    try {
      const pool = await IndexedFileModel.find(
        scopeQuery,
        { name: 1, path: 1, type: 1, sizeKB: 1, createdAt: 1, extractedText: 1 }
      )
        .sort({ updatedAt: -1 })
        .limit(2600)
        .lean();
      const fuzzyDocs = pool
        .map((d) => ({ ...d, score: fuzzyScore(expandedQuery || cleanQuery, d) }))
        .filter((d) => d.score >= 0.16)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 420);
      pushCandidates(fuzzyDocs, 0.1);
    } catch {}

    // 4) Face/person intent broadens image recall.
    if (isFaceIntent(expandedQuery || cleanQuery)) {
      const faceTerms = ["face", "selfie", "person", "people", "portrait", "human", "board", "whiteboard"];
      const imagePool = await IndexedFileModel.find(
        combineQueries(scopeQuery, { type: "image" }),
        { name: 1, path: 1, type: 1, sizeKB: 1, createdAt: 1, extractedText: 1 }
      )
        .sort({ updatedAt: -1 })
        .limit(1100)
        .lean();

      const faceRanked = imagePool
        .map((d) => {
          const hay = docHaystack(d);
          const hits = faceTerms.filter((t) => hay.includes(t)).length;
          return { ...d, score: hits > 0 ? 0.34 + hits * 0.06 : 0.18 };
        })
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 350);
      pushCandidates(faceRanked, 0.08);
    }

    let docs = [...candidates.values()]
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 650);

    if (OPEN_VOCAB_IMAGE_INDEX && isVisualSemanticIntent(expandedQuery || cleanQuery)) {
      const needsVisionText = docs
        .filter((d) => d?.type === "image" && String(d?.extractedText || "").trim().length < 20)
        .slice(0, Math.max(1, OPEN_VOCAB_QUERY_ENRICH_LIMIT));
      for (const img of needsVisionText) {
        const p = String(img?.path || "").trim();
        if (!p || !fs.existsSync(p)) continue;
        try {
          const semanticText = String(
            await describeImageSemanticSafe(p, {
              prompt:
                "Describe this image for search with keywords about people, clothing, colors, objects, scene, and visible text.",
            }) || ""
          ).trim();
          if (!semanticText) continue;
          img.extractedText = mergeExtractedText(img.extractedText || "", semanticText);
          if (img?._id) {
            await IndexedFileModel.updateOne(
              { _id: img._id },
              { $set: { extractedText: img.extractedText } }
            );
          }
        } catch {}
      }
    }

    // On-demand enrichment for people/face queries:
    // refresh OCR/vision text for a small image subset that lacks extracted text.
    if (isFaceIntent(expandedQuery || cleanQuery)) {
      const missingTextImages = docs
        .filter((d) => d?.type === "image" && !(String(d?.extractedText || "").trim()))
        .slice(0, 20);
      for (const img of missingTextImages) {
        const p = String(img?.path || "").trim();
        if (!p || !fs.existsSync(p)) continue;
        try {
          const enriched = String(await extractTextSafe(p, { forceAiFallback: true }) || "").trim();
          if (!enriched) continue;
          img.extractedText = enriched;
          if (img?._id) {
            await IndexedFileModel.updateOne(
              { _id: img._id },
              { $set: { extractedText: enriched } }
            );
          }
        } catch {}
      }
    }

    const semantic = await applySemanticRerank(docs, expandedQuery || cleanQuery);
    docs = semantic.docs;
    const clipRerank = await applyClipImageRerank(docs, expandedQuery || cleanQuery);
    docs = clipRerank.docs;
    const llmRerank = await applyLlmQueryRerank(docs, expandedQuery || cleanQuery);
    docs = llmRerank.docs;

    const hybridTokens = [...new Set(tokenizeQuery(expandedQuery || cleanQuery))];
    let threshold = clamp01(HYBRID_MIN_CONFIDENCE);
    if (hybridTokens.length <= 2) threshold = Math.max(0.22, threshold - 0.12);
    if (isFaceIntent(expandedQuery || cleanQuery)) threshold = Math.max(0.2, threshold - 0.1);
    const withConfidence = docs.map((d) => {
      const conf = hybridConfidence(d, expandedQuery || cleanQuery, hybridTokens);
      const hay = docHaystack(d);
      const exactTokenHit = hybridTokens.some((t) => t && hay.includes(t));
      return {
        ...d,
        confidence: conf,
        exactTokenHit,
      };
    });

    withConfidence.sort((a, b) => {
      if ((b.confidence || 0) !== (a.confidence || 0)) {
        return (b.confidence || 0) - (a.confidence || 0);
      }
      return Number(b.score || 0) - Number(a.score || 0);
    });

    const filtered = HYBRID_RANKING_ENABLED
      ? withConfidence.filter((d) => (d.confidence || 0) >= threshold || d.exactTokenHit)
      : withConfidence;

    docs = (filtered.length ? filtered : withConfidence).slice(0, Math.max(1, HYBRID_MAX_RESULTS));

    for (const doc of docs) {
      const isImageDoc = doc.type === "image";
      if (doc.fileHash && (!isImageDoc || doc.imageHash)) continue;
      if (!doc.path || !fs.existsSync(doc.path)) continue;
      try {
        const fileHash = doc.fileHash || (await computeFileHash(doc.path));
        const imageHash = isImageDoc
          ? doc.imageHash || (await computeDhash(doc.path))
          : null;
        doc.fileHash = fileHash;
        if (isImageDoc) doc.imageHash = imageHash;
        await IndexedFileModel.updateOne(
          { _id: doc._id },
          isImageDoc ? { $set: { fileHash, imageHash } } : { $set: { fileHash } }
        );
      } catch {}
    }

    res.json({
      files: docs,
      top5: docs.slice(0, 5),
      aiQuery: {
        enabled: AI_QUERY_ASSIST,
        rewrittenQuery: aiHints.rewrittenQuery || "",
        keywords: aiHints.keywords || [],
      },
      aiSemantic: semantic.meta,
      aiClip: clipRerank.meta,
      aiLlmRerank: llmRerank.meta,
      aiHybrid: {
        enabled: HYBRID_RANKING_ENABLED,
        threshold,
        candidates: withConfidence.length,
        returned: docs.length,
      },
    });
  } catch {
    res.status(500).json({ error: "Search failed" });
  }
});

/* =======================================================
   🤖 POST /api/search/ask
======================================================= */
router.post("/reocr", async (req, res) => {
  try {
    if (!IndexedFileModel) {
      return res.status(500).json({ ok: false, error: "Index unavailable" });
    }

    const filePath = String(req.body?.path || "").trim();
    if (!filePath) {
      return res.status(400).json({ ok: false, error: "Path is required." });
    }

    const docPathKey = normalizePathKey(filePath);
    const doc = await IndexedFileModel.findOne({
      $or: [{ pathKey: docPathKey }, { path: filePath }],
    })
      .select("_id name path type extractedText sizeKB createdAt updatedAt")
      .lean();

    if (!doc) {
      return res.status(404).json({ ok: false, error: "Indexed file not found." });
    }

    if (!fs.existsSync(doc.path)) {
      return res.status(404).json({ ok: false, error: "File not found on disk." });
    }

    const nextText = await extractTextSafe(doc.path, { forceAiFallback: true });
    const safeText = String(nextText || "").slice(0, 20000);

    await IndexedFileModel.updateOne(
      { _id: doc._id },
      { $set: { extractedText: safeText } }
    );

    return res.json({
      ok: true,
      file: {
        ...doc,
        extractedText: safeText,
      },
    });
  } catch (err) {
    console.error("Re-OCR failed:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Re-OCR failed." });
  }
});

router.post("/ask", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    const file = req.body?.file || {};

    if (!question) {
      return res.status(400).json({ ok: false, error: "Question is required." });
    }

    let selectedFile = null;
    if (IndexedFileModel && file.path) {
      const filePathKey = normalizePathKey(file.path);
      selectedFile = await IndexedFileModel.findOne({
        $or: [{ pathKey: filePathKey }, { path: file.path }],
      })
        .select("name path type extractedText")
        .lean();
    }

    const fileContext = {
      name: selectedFile?.name || file.name || "",
      path: selectedFile?.path || file.path || "",
      type: selectedFile?.type || file.type || "",
      extractedText: selectedFile?.extractedText || file.extractedText || "",
    };

    const answer = await askLlmAboutFile({ question, fileContext });
    if (!String(answer || "").trim()) {
      return res.status(502).json({ ok: false, error: "LLM returned empty answer." });
    }

    return res.json({ ok: true, answer: String(answer).trim() });
  } catch (err) {
    console.error("LLM ask failed:", err?.message || err);
    const statusCode = Number(err?.statusCode || err?.response?.status || 500);
    return res
      .status(statusCode === 429 ? 429 : 500)
      .json({ ok: false, error: err?.message || "LLM request failed." });
  }
});

router.post("/share/public-link", async (req, res) => {
  try {
    const rawPath = String(req.body?.path || "").trim();
    const nameHint = String(req.body?.name || "").trim();
    if (!rawPath) {
      return res.status(400).json({ ok: false, error: "Path is required." });
    }
    if (!fs.existsSync(rawPath)) {
      return res.status(404).json({ ok: false, error: "File not found." });
    }
    const ext = path.extname(rawPath || "").toLowerCase();
    const previewBuffer = await createSharePreviewJpegBuffer({
      filePath: rawPath,
      suggestedName: nameHint || path.basename(rawPath, ext),
    });
    const suggestedName = nameHint || path.basename(rawPath, ext);

    const previewUrl = await uploadImageToCloudinary({
      imagePath: rawPath,
      sourceBuffer: previewBuffer,
      suggestedName,
    });
    const documentUrl = await uploadOriginalFileToCloudinary({
      filePath: rawPath,
      suggestedName,
    });
    return res.json({
      ok: true,
      url: documentUrl || previewUrl,
      documentUrl,
      previewUrl,
      provider: "cloudinary",
    });
  } catch (err) {
    console.error("Public share link failed:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Could not create public share link.",
    });
  }
});

/* =======================================================
   🖼️ POST /api/search/image-match
======================================================= */
router.post(
  "/image-match",
  upload.single("image"),
  async (req, res) => {
    const uploadedPath = req.file?.path;
    try {
      if (!IndexedFileModel) {
        return res.status(500).json({ ok: false, message: "Index unavailable" });
      }
      if (!uploadedPath) {
        return res.status(400).json({ ok: false, message: "No image uploaded" });
      }

      const queryFileHash = await computeFileHash(uploadedPath);
      const queryImageHash = await computeDhash(uploadedPath);
      let parsedScope = [];
      try {
        if (Array.isArray(req.body?.scopeFolders)) {
          parsedScope = req.body.scopeFolders;
        } else if (typeof req.body?.scopeFolders === "string") {
          parsedScope = JSON.parse(req.body.scopeFolders || "[]");
        }
      } catch {
        parsedScope = [];
      }
      const scopeQuery = buildScopeMongoQuery(parsedScope);

      const pool = await IndexedFileModel.find(
        combineQueries(scopeQuery, { type: "image" }),
        {
          name: 1,
          path: 1,
          type: 1,
          sizeKB: 1,
          createdAt: 1,
          extractedText: 1,
          fileHash: 1,
          imageHash: 1,
        }
      )
        .limit(4000)
        .lean();

      const matches = [];
      const SIMILARITY_THRESHOLD = 10;

      for (const doc of pool) {
        let imageHash = doc.imageHash;
        let fileHash = doc.fileHash;

        if ((!imageHash || !fileHash) && doc.path && fs.existsSync(doc.path)) {
          try {
            if (!fileHash) fileHash = await computeFileHash(doc.path);
            if (!imageHash) imageHash = await computeDhash(doc.path);
            await IndexedFileModel.updateOne(
              { _id: doc._id },
              { $set: { fileHash, imageHash } }
            );
          } catch {}
        }

        if (fileHash && fileHash === queryFileHash) {
          matches.push({ ...doc, fileHash, imageHash, score: 1, matchType: "exact" });
          continue;
        }

        if (imageHash) {
          const dist = hammingDistanceHex(queryImageHash, imageHash);
          if (dist <= SIMILARITY_THRESHOLD) {
            const score = 1 - dist / 64;
            matches.push({ ...doc, fileHash, imageHash, score, matchType: "similar" });
          }
        }
      }

      matches.sort((a, b) => b.score - a.score);

      return res.json({
        ok: true,
        files: matches.slice(0, 300),
        top5: matches.slice(0, 5),
      });
    } catch (err) {
      console.error("Image match error:", err);
      return res.status(500).json({ ok: false, message: "Image match failed" });
    } finally {
      if (uploadedPath) {
        try { fs.unlinkSync(uploadedPath); } catch {}
      }
    }
  }
);

/* =======================================================
   📊 GET /api/search/stats
======================================================= */
router.get("/stats", async (_, res) => {
  try {
    const count = await IndexedFileModel.countDocuments();
    res.json({ indexed: count });
  } catch {
    res.json({ indexed: 0 });
  }
});

module.exports = router;
