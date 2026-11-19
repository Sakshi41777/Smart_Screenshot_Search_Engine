const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const axios = require("axios");
const IndexedFile = require("../models/IndexedFile");
const { sendProgress } = require("./searchProgress");
const { extractTextSafe } = require("../services/ocr");
const os = require("os");
const { dHash, hashSimilarity } = require("../services/phash");
const { requireDb } = require("../services/db");
const {
  heuristicTagsForPath,
  requestVisualScores,
  tagScoreFromTags,
  combineScores,
} = require("../services/ml");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"]);
const DOC_EXTS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".md",
  ".csv",
  ".log",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".html",
  ".css",
]);
const LLM_PROVIDER = String(process.env.LLM_PROVIDER || "openai").toLowerCase();
const LLM_MODEL = String(process.env.LLM_MODEL || "gpt-4o-mini").trim();
const OPENAI_BASE_URL = String(
  process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
).replace(/\/+$/, "");
const OPENAI_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const GEMINI_BASE_URL = String(
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"
).replace(/\/+$/, "");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const AI_QUERY_TIMEOUT_MS = Number(process.env.AI_QUERY_TIMEOUT_MS || 12_000);
const MAX_ASK_CONTEXT_CHARS = 14_000;
const ASK_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

let indexState = {
  running: false,
  cancelRequested: false,
};

function normalizePathKey(filePath = "") {
  try {
    return path.resolve(String(filePath || "").trim()).toLowerCase();
  } catch {
    return String(filePath || "").trim().toLowerCase();
  }
}

function normalizeFolders(folders = []) {
  return (Array.isArray(folders) ? folders : [])
    .map((folder) => String(folder || "").trim())
    .filter(Boolean)
    .map((folder) => path.resolve(folder))
    .filter((folder, idx, arr) => arr.indexOf(folder) === idx)
    .filter((folder) => {
      try {
        return fs.existsSync(folder) && fs.statSync(folder).isDirectory();
      } catch {
        return false;
      }
    });
}

function isSupportedExt(ext = "") {
  return IMAGE_EXTS.has(ext) || DOC_EXTS.has(ext);
}

function isImageExt(ext = "") {
  return IMAGE_EXTS.has(ext);
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  const i = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  const units = ["B", "KB", "MB", "GB"];
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Folders that never contain the user's own screenshots/documents. Skipping them
// keeps "index my whole Desktop / Documents / drive" fast and free of noise.
const SKIP_DIR_NAMES = new Set([
  "node_modules", ".git", ".svn", ".hg", ".venv", "venv", "env", "__pycache__",
  ".next", ".nuxt", ".cache", ".gradle", ".idea", ".vscode", "bower_components",
  "appdata", "application data", "$recycle.bin", "system volume information",
  "windows", "program files", "program files (x86)", "programdata", "recovery",
  "$windows.~bt", "$windows.~ws", "msocache", "perflogs",
]);

function shouldSkipDir(name = "") {
  const lower = String(name || "").toLowerCase();
  if (!lower) return true;
  if (SKIP_DIR_NAMES.has(lower)) return true;
  // Hidden/system folders like .config, .npm, $SysReset
  return lower.startsWith(".") || lower.startsWith("$");
}

// Walks every subfolder of rootFolder (any depth) and collects supported files.
// Async so a huge folder or a whole drive never freezes the backend.
async function walkFolder(rootFolder, out = [], onProgress = null) {
  const stack = [rootFolder];
  let visitedDirs = 0;
  while (stack.length) {
    if (indexState.cancelRequested) break;
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // no permission / vanished: skip quietly
    }
    visitedDirs += 1;
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      // Symlinks/junctions are not followed (avoids loops like "My Music").
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) stack.push(entryPath);
      } else if (entry.isFile() && isSupportedExt(path.extname(entry.name).toLowerCase())) {
        out.push(entryPath);
      }
    }
    if (onProgress && visitedDirs % 200 === 0) onProgress(out.length, visitedDirs);
  }
  return out;
}

function fileHashSafe(filePath, maxBytes = 75 * 1024 * 1024) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size > maxBytes) return null;
    return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function mapIndexedFile(doc, score = 0) {
  return {
    id: String(doc._id),
    _id: String(doc._id),
    name: doc.name || "",
    path: doc.path || "",
    thumbnailUrl: doc.thumbnailUrl || "",
    size: doc.size || humanSize(Number(doc.sizeBytes || 0)),
    sizeKB: Number(doc.sizeKB || 0),
    sizeBytes: Number(doc.sizeBytes || doc.sourceSizeBytes || 0),
    mtime: doc.mtime || "",
    type: doc.type || "image",
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    extractText: doc.extractText || doc.extractedText || "",
    extractedText: doc.extractedText || doc.extractText || "",
    fileHash: doc.fileHash || null,
    imageHash: doc.imageHash || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    score,
  };
}

function folderScopeFilter(scopeFolders = []) {
  const folders = normalizeFolders(scopeFolders);
  if (!folders.length) return {};
  const escaped = folders.map((folder) =>
    normalizePathKey(folder).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  // Folder itself or anything below it, but not a sibling like "Desktop-old".
  return { pathKey: { $regex: `^(${escaped.join("|")})([\\\\/]|$)` } };
}

function parseJsonArray(raw, fallback = []) {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function looksLikeOcrNoise(text = "") {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return true;
  const chars = clean.length;
  const letters = (clean.match(/[a-zA-Z]/g) || []).length;
  const upper = (clean.match(/[A-Z]/g) || []).length;
  const lower = (clean.match(/[a-z]/g) || []).length;
  const words = clean.split(/\s+/).filter(Boolean);
  const longWords = words.filter((word) => /[a-zA-Z]{3,}/.test(word)).length;
  const symbolish = (clean.match(/[@~_^|\\{}[\]<>]/g) || []).length;
  const oddTokens = words.filter((word) => /[A-Z]{4,}[a-z]{0,2}[A-Z]{2,}|[A-Za-z]*\d+[A-Za-z]+\d*/.test(word)).length;
  const letterRatio = letters / Math.max(chars, 1);
  const oddRatio = oddTokens / Math.max(words.length, 1);
  const upperRatio = upper / Math.max(letters, 1);
  const hasVeryLongNoiseToken = words.some((word) => /[A-Z]{8,}/.test(word) && !/[aeiou]{2}/i.test(word));
  return (
    chars < 24 ||
    letterRatio < 0.45 ||
    symbolish > chars * 0.08 ||
    oddRatio > 0.35 ||
    longWords < 3 ||
    (words.length >= 8 && upperRatio > 0.72 && lower < 8) ||
    hasVeryLongNoiseToken
  );
}

function decodeHtmlEntities(text = "") {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCharCode(Number(code));
      } catch {
        return "";
      }
    });
}

function looksLikeHtml(text = "", file = {}) {
  const name = String(file.name || "").toLowerCase();
  const raw = String(text || "");
  return (
    name.endsWith(".html") ||
    /<!doctype\s+html/i.test(raw) ||
    /<html[\s>]/i.test(raw) ||
    /<meta[\s>]/i.test(raw) ||
    /<a\s+[^>]*href=/i.test(raw)
  );
}

function cleanHtmlForReading(text = "") {
  return decodeHtmlEntities(String(text || ""))
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findColorMentions(text = "") {
  const raw = String(text || "");
  const matches = raw.match(
    /\b(?:red|green|blue|yellow|black|white|orange|purple|pink|gray|grey)\b|#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)/gi
  );
  return Array.from(new Set(matches || [])).slice(0, 12);
}

function getReadableContext(text = "", file = {}) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (looksLikeHtml(raw, file)) {
    const cleaned = cleanHtmlForReading(raw);
    return cleaned || "This appears to be an HTML file, but no readable page text was extracted.";
  }
  return raw;
}

function makeLocalAskAnswer({ question, name, text }) {
  const file = { name };
  const readableText = getReadableContext(text, file);
  const q = String(question || "").toLowerCase();

  if (looksLikeHtml(text, file) && /\b(red|color|colour)\b/i.test(q)) {
    const colors = findColorMentions(text);
    if (!colors.length || !colors.some((c) => /^red$/i.test(c) || /^#f00/i.test(c) || /^#ff0000/i.test(c) || /rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)/i.test(c))) {
      return `I do not see a clear red color reference in ${name}. This file looks like saved HTML/embed code, so open the original page or inspect the CSS if you need the visual color location.`;
    }
    return `I found these color references in ${name}: ${colors.join(", ")}. Check the matching CSS rule or element in the HTML.`;
  }

  if (looksLikeOcrNoise(readableText)) {
    return `I could not read enough reliable text from ${name} to answer normally. The extracted text looks noisy, so try Refresh Text or check that the AI provider is working.`;
  }
  const snippet = readableText.replace(/\s+/g, " ").slice(0, 700);
  const prefix = question ? `For "${question}", ` : "";
  return `${prefix}${name} appears to contain: ${snippet}${readableText.length > 700 ? "..." : ""}`;
}

function getImageDataUrl(filePath = "") {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size <= 0 || st.size > ASK_IMAGE_MAX_BYTES) return "";
    const ext = path.extname(filePath).toLowerCase();
    const mimeByExt = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".bmp": "image/bmp",
    };
    const mime = mimeByExt[ext];
    if (!mime) return "";
    return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
  } catch {
    return "";
  }
}

function buildAskMessages({ question, file, includeImage = false }) {
  const name = String(file.name || "selected file").trim();
  const type = String(file.type || "file").trim();
  const filePath = String(file.path || "").trim();
  const rawText = String(file.extractedText || file.extractText || "").trim();
  const text = getReadableContext(rawText, file).slice(0, MAX_ASK_CONTEXT_CHARS);

  const userText = [
    `Question: ${question}`,
    `File name: ${name}`,
    `File type: ${type}`,
    filePath ? `File path: ${filePath}` : "",
    looksLikeHtml(rawText, file)
      ? "Note: The original extracted content looked like HTML. The text below has been cleaned for readability."
      : "",
    looksLikeOcrNoise(text)
      ? "Note: The OCR text may be noisy. If an image is attached, use the image directly."
      : "",
    "File text:",
    text,
  ]
    .filter(Boolean)
    .join("\n");
  const imageUrl = includeImage ? getImageDataUrl(filePath) : "";

  return [
    {
      role: "system",
      content:
        "You answer questions about one selected search result. Use the provided file text, metadata, and image if present. If the text is garbled, say what can be inferred cautiously instead of repeating noise. Keep the answer concise and useful.",
    },
    {
      role: "user",
      content: imageUrl
        ? [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: imageUrl } },
          ]
        : userText,
    },
  ];
}

async function askWithOpenAi({ question, file }) {
  if (!OPENAI_API_KEY) return "";
  const response = await axios.post(
    `${OPENAI_BASE_URL}/chat/completions`,
    {
      model: LLM_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 500,
      messages: buildAskMessages({ question, file, includeImage: true }),
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: AI_QUERY_TIMEOUT_MS,
    }
  );
  return String(response?.data?.choices?.[0]?.message?.content || "").trim();
}

async function askWithGemini({ question, file }) {
  if (!GEMINI_API_KEY) return "";
  const messages = buildAskMessages({ question, file });
  const prompt = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
  const response = await axios.post(
    `${GEMINI_BASE_URL}/models/${encodeURIComponent(LLM_MODEL || "gemini-1.5-flash")}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
    },
    { timeout: AI_QUERY_TIMEOUT_MS }
  );
  const parts = response?.data?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((part) => part?.text || "").join("").trim() : "";
}

function summarizeProviderError(err) {
  const status = err?.response?.status;
  const code = err?.code;
  const message =
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    String(err || "Unknown error");
  return [status ? `status ${status}` : "", code || "", message]
    .filter(Boolean)
    .join(" - ")
    .slice(0, 240);
}

async function askWithConfiguredProvider({ question, file }) {
  try {
    if (LLM_PROVIDER === "gemini") {
      return { answer: await askWithGemini({ question, file }), error: "" };
    }
    return { answer: await askWithOpenAi({ question, file }), error: "" };
  } catch (err) {
    const summary = summarizeProviderError(err);
    console.warn("[ASK AI FALLBACK]", summary);
    return { answer: "", error: summary };
  }
}

function scoreDoc(doc, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return 0.5;
  const name = String(doc.name || "").toLowerCase();
  const text = String(doc.extractedText || doc.extractText || "").toLowerCase();
  const tags = Array.isArray(doc.tags) ? doc.tags.join(" ").toLowerCase() : "";
  const pathText = String(doc.path || "").toLowerCase();
  const hay = `${name} ${tags} ${pathText} ${text}`;
  const tokens = q.split(/\s+/).filter(Boolean);
  let score = 0;
  if (name.includes(q)) score += 3;
  if (text.includes(q)) score += 2;
  if (pathText.includes(q)) score += 1.2;
  for (const token of tokens) {
    if (name.includes(token)) score += 1;
    if (text.includes(token)) score += 0.7;
    if (tags.includes(token)) score += 0.6;
    if (hay.includes(token)) score += 0.2;
  }
  return score;
}

async function upsertIndexedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isImage = isImageExt(ext);
  const st = fs.statSync(filePath);
  const pathKey = normalizePathKey(filePath);
  const existing = await IndexedFile.findOne({ pathKey }).lean();

  if (
    existing &&
    Number(existing.sourceSizeBytes || 0) === st.size &&
    Number(existing.sourceMtimeMs || 0) === st.mtimeMs
  ) {
    return { changed: false, doc: existing };
  }

  const finalText = await extractTextSafe(filePath);
  const perceptualHash = isImage ? await dHash(filePath) : null;
  const sizeKB = Math.max(1, Math.round(st.size / 1024));
  const hash = fileHashSafe(filePath);

  const update = {
    name: path.basename(filePath),
    path: filePath,
    pathKey,
    type: isImage ? "image" : "document",
    extractedText: finalText,
    extractText: finalText,
    size: humanSize(st.size),
    sizeKB,
    sizeBytes: st.size,
    sourceSizeBytes: st.size,
    sourceMtimeMs: st.mtimeMs,
    mtime: st.mtime.toISOString(),
    tags: heuristicTagsForPath(filePath),
    fileHash: hash,
    imageHash: isImage ? hash : null,
    perceptualHash,
  };

  const doc = await IndexedFile.findOneAndUpdate(
    { pathKey },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return { changed: true, doc };
}

async function runIndexing(folders) {
  try {
    const files = [];
    for (const folder of folders) {
      await walkFolder(folder, files, (found) => {
        sendProgress(`Scanning folders... ${found} files found`, "working");
      });
    }
    const total = files.length;
    sendProgress(`0 / ${total}`, "working");

    let done = 0;
    for (const filePath of files) {
      if (indexState.cancelRequested) {
        sendProgress("Setup stopped.", "canceled");
        return;
      }
      try {
        await upsertIndexedFile(filePath);
      } catch (err) {
        console.warn("[INDEX SKIPPED]", filePath, err?.message || err);
      }
      done += 1;
      if (done === total || done % 3 === 0) {
        sendProgress(`${done} / ${total}`, "working");
      }
    }

    sendProgress(`Indexing complete (${done} files)`, "done");
  } catch (err) {
    console.error("[INDEX FAILED]", err);
    sendProgress("Indexing failed.", "error");
  } finally {
    indexState.running = false;
    indexState.cancelRequested = false;
  }
}

router.use(requireDb);

router.post("/index-folders", async (req, res) => {
  const folders = normalizeFolders(req.body?.folders);
  if (!folders.length) {
    return res.status(400).json({ ok: false, error: "No valid folders provided." });
  }
  if (indexState.running) {
    return res.status(409).json({ ok: false, error: "Indexing is already running." });
  }

  indexState = { running: true, cancelRequested: false };
  sendProgress("Preparing files...", "working");
  setImmediate(() => runIndexing(folders));
  return res.status(202).json({ ok: true, folders });
});

router.post("/cancel-index", (req, res) => {
  if (indexState.running) {
    indexState.cancelRequested = true;
    sendProgress("Stopping...", "canceling");
  }
  res.json({ ok: true });
});

router.post("/reocr", async (req, res) => {
  const filePath = String(req.body?.path || "").trim();
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "File not found." });
  }
  const result = await upsertIndexedFile(filePath);
  return res.json({ ok: true, file: mapIndexedFile(result.doc, 1) });
});

router.post("/ask", async (req, res) => {
  const question = String(req.body?.question || "").trim();
  const file = req.body?.file || {};
  const text = String(file.extractedText || file.extractText || "").trim();
  const name = String(file.name || "this file").trim();
  if (!question) {
    return res.status(400).json({ ok: false, error: "Question is required." });
  }
  if (!text) {
    return res.json({
      ok: true,
      answer: `I could not find readable text in ${name}. Try Refresh Text first.`,
      source: "local",
    });
  }

  const aiResult = await askWithConfiguredProvider({ question, file });
  const aiAnswer = String(aiResult.answer || "").trim();
  res.json({
    ok: true,
    answer: aiAnswer || makeLocalAskAnswer({ question, name, text }),
    source: aiAnswer ? LLM_PROVIDER : "local",
    fallbackReason: aiAnswer ? "" : aiResult.error || "AI provider unavailable",
  });
});

router.post("/share/public-link", (req, res) => {
  const filePath = String(req.body?.path || "").trim();
  if (!filePath) return res.status(400).json({ ok: false, error: "Path is required." });
  const token = crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 16);
  res.json({ ok: true, url: `smartshot://shared/${token}` });
});

const IMAGE_MATCH_MIN_VISUAL = 0.8; // dHash similarity; unrelated images sit near 0.5
const IMAGE_MATCH_LAZY_HASH_LIMIT = 600; // hashes computed per request for older rows

function textTokens(text = "") {
  const words = String(text || "")
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9@._-]{2,}/g) || [];
  return [...new Set(words)].slice(0, 40);
}

function textOverlap(tokens = [], haystack = "") {
  if (!tokens.length) return 0;
  const hay = String(haystack || "").toLowerCase();
  if (!hay) return 0;
  let hits = 0;
  for (const t of tokens) if (hay.includes(t)) hits += 1;
  return hits / tokens.length;
}

async function ocrUploadedImage(file) {
  const ext = path.extname(String(file?.originalname || "")).toLowerCase() || ".png";
  const tmp = path.join(os.tmpdir(), `smartshot-query-${Date.now()}${ext}`);
  try {
    fs.writeFileSync(tmp, file.buffer);
    return await extractTextSafe(tmp);
  } catch {
    return "";
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// Search by image: finds the same/similar picture (perceptual hash) AND
// screenshots containing the same text (OCR), so a cropped region also works.
router.post("/image-match", upload.single("image"), async (req, res) => {
  if (!req.file?.buffer?.length) {
    return res.status(400).json({ ok: false, error: "Please choose an image to search with." });
  }

  const [queryHash, queryText] = await Promise.all([
    dHash(req.file.buffer),
    ocrUploadedImage(req.file),
  ]);
  const tokens = textTokens(queryText);

  const filter = { ...folderScopeFilter(parseJsonArray(req.body?.scopeFolders)), type: "image" };
  const rows = await IndexedFile.find(filter, { semanticVector: 0, imageVector: 0 })
    .sort({ updatedAt: -1 })
    .limit(20000)
    .lean();

  // Rows indexed before this feature have no perceptual hash yet: fill some in now.
  if (queryHash) {
    const missing = rows.filter((r) => !r.perceptualHash).slice(0, IMAGE_MATCH_LAZY_HASH_LIMIT);
    const updates = [];
    for (let i = 0; i < missing.length; i += 8) {
      const batch = missing.slice(i, i + 8);
      const hashes = await Promise.all(batch.map((r) => dHash(r.path)));
      batch.forEach((row, j) => {
        if (!hashes[j]) return;
        row.perceptualHash = hashes[j];
        updates.push({
          updateOne: { filter: { _id: row._id }, update: { $set: { perceptualHash: hashes[j] } } },
        });
      });
    }
    if (updates.length) {
      try { await IndexedFile.bulkWrite(updates, { ordered: false }); } catch {}
    }
  }

  const files = [];
  for (const row of rows) {
    const visual = queryHash ? hashSimilarity(queryHash, row.perceptualHash) : 0;
    const visualScore = visual >= IMAGE_MATCH_MIN_VISUAL ? visual : 0;
    const overlap = textOverlap(tokens, row.extractedText || row.extractText || "");
    const textScore = tokens.length >= 2 && overlap >= 0.4 ? overlap * 0.95 : 0;
    const score = Math.max(visualScore, textScore);
    if (score > 0) {
      const mapped = mapIndexedFile(row, Number(score.toFixed(4)));
      mapped.matchType = visualScore >= textScore ? "visual" : "text";
      files.push(mapped);
    }
  }
  files.sort((a, b) => b.score - a.score);

  res.json({ ok: true, files: files.slice(0, 200), queryText: queryText.slice(0, 300) });
});

router.post("/reset-app", async (req, res) => {
  if (req.body?.confirm !== "RESET_APP") {
    return res.status(400).json({ ok: false, error: "Missing reset confirmation." });
  }
  const result = await IndexedFile.deleteMany({});
  sendProgress("App data reset.", "done");
  res.json({ ok: true, deletedCount: Number(result?.deletedCount || 0) });
});

router.post("/", async (req, res) => {
  const query = String(req.body?.query || "").trim();
  const scope = folderScopeFilter(req.body?.scopeFolders);
  const filter = { ...scope };
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length) {
    // Let MongoDB find every matching file in the selected folder(s) and all
    // subfolders, instead of scoring only the most recently indexed rows.
    const anyToken = tokens.join("|");
    filter.$or = [
      { name: { $regex: anyToken, $options: "i" } },
      { extractedText: { $regex: anyToken, $options: "i" } },
      { pathKey: { $regex: anyToken, $options: "i" } },
      { tags: { $regex: anyToken, $options: "i" } },
    ];
  }
  const rows = await IndexedFile.find(filter, { semanticVector: 0, imageVector: 0 })
    .sort({ updatedAt: -1 })
    .limit(tokens.length ? 20000 : 1000)
    .lean();
  const files = rows
    .map((row) => mapIndexedFile(row, scoreDoc(row, query)))
    .filter((file) => !query || file.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 300);
  res.json({ ok: true, files });
});

function pathIsJunk(filePath = "") {
  return String(filePath || "")
    .split(/[\\/]+/)
    .slice(0, -1)
    .some((part) => part && shouldSkipDir(part));
}

function pathAllowed(filePath = "", allowedFolders = []) {
  const folders = normalizeFolders(allowedFolders);
  if (!folders.length) return true;
  const key = normalizePathKey(filePath);
  return folders.some((f) => {
    const root = normalizePathKey(f);
    return key === root || key.startsWith(root + path.sep) || key.startsWith(root + "/");
  });
}

// Called by the desktop app's folder watcher when a file is added or changed.
router.post("/sync-file", async (req, res) => {
  const filePath = String(req.body?.path || "").trim();
  if (!filePath) return res.status(400).json({ ok: false, error: "Path is required." });
  const ext = path.extname(filePath).toLowerCase();
  if (!isSupportedExt(ext) || pathIsJunk(filePath) || !pathAllowed(filePath, req.body?.allowedFolders)) {
    return res.json({ ok: true, skipped: true });
  }
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return res.json({ ok: true, skipped: true });
    const { changed } = await upsertIndexedFile(filePath);
    return res.json({ ok: true, changed });
  } catch (err) {
    // File still being written / locked: the watcher retries on non-2xx.
    return res.status(503).json({ ok: false, error: err?.message || "Could not index file yet." });
  }
});

// Called by the watcher when a file or folder is deleted or renamed away.
router.post("/sync-delete", async (req, res) => {
  const filePath = String(req.body?.path || "").trim();
  if (!filePath) return res.status(400).json({ ok: false, error: "Path is required." });
  const key = normalizePathKey(filePath);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const result = await IndexedFile.deleteMany({
    $or: [{ pathKey: key }, { pathKey: { $regex: `^${escaped}[\\\\/]` } }],
  });
  return res.json({ ok: true, deleted: Number(result?.deletedCount || 0) });
});

router.all("*", (req, res) => {
  res.status(404).json({ ok: false, error: "Unknown search endpoint." });
});

module.exports = router;
