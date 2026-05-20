#!/usr/bin/env node
/**
 * backend_node/scripts/indexer.js
 *
 * Usage:
 *   node backend_node/scripts/indexer.js --path "/absolute/path/to/scan" [--rebuild] [--limit 1000] [--dry]
 *
 * Behavior:
 *  - Connects to MongoDB if MONGO_URI is set and IndexedFile model exists.
 *  - Otherwise writes a JSON index to backend_node/data/index.json
 *  - Produces sanitized entries only: { name, path, thumbnailUrl, size, mtime, type, tags, extractText }
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const util = require("util");
const crypto = require("crypto");
const { spawn } = require("child_process");

const sharp = require("sharp");
const pdf = require("pdf-parse");
const Tesseract = require("tesseract.js");

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const mongoose = require("mongoose");

// Load env (if running via node directly)
require("dotenv").config();

const argv = yargs(hideBin(process.argv))
  .option("path", { type: "string", describe: "Folder path to scan (absolute)", demandOption: false })
  .option("rebuild", { type: "boolean", describe: "Drop and rebuild index", default: false })
  .option("limit", { type: "number", describe: "Max number of files to process", default: 5000 })
  .option("dry", { type: "boolean", describe: "Dry run (don't persist)", default: false })
  .help()
  .argv;

const SCAN_PATH = argv.path || null;
const REBUILD = argv.rebuild;
const LIMIT = Number(argv.limit) || 5000;
const DRY = argv.dry || false;

// ensure output dir exists
const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}
const OUT_JSON = path.join(DATA_DIR, "index.json");

// Minimal ALLOWED_ROOTS: reuse config from routes/search.js style.
// If you have ALLOWED_ROOTS in that file, set the same here (or leave empty to allow any path)
const ALLOWED_ROOTS = []; // leave empty for dev convenience; set absolute paths here for prod safety

function isPathAllowed(p) {
  try {
    if (!ALLOWED_ROOTS || ALLOWED_ROOTS.length === 0) return true;
    const resolved = path.resolve(p);
    return ALLOWED_ROOTS.some((root) => resolved.startsWith(path.resolve(root)));
  } catch (e) {
    return false;
  }
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const i = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  const units = ["B", "KB", "MB", "GB"];
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp", ".tiff"]);
const DOC_EXTS = new Set([".pdf", ".docx", ".doc", ".txt"]);

// simple heuristics to produce tags (same as search route)
function heuristicTagsForPath(p) {
  const name = path.basename(p).toLowerCase();
  const tags = [];
  if (name.includes("invoice") || name.includes("bill") || name.includes("receipt")) tags.push("invoice", "document");
  if (name.includes("error") || name.includes("stack") || name.includes("trace")) tags.push("error", "screenshot");
  if (name.includes("screen") || name.includes("screenshot") || name.includes("ui")) tags.push("ui", "screenshot");
  if (/\b(logo|product|photo|img|image)\b/.test(name)) tags.push("photo", "image");
  const ext = path.extname(name);
  if ([".png", ".jpg", ".jpeg"].includes(ext)) tags.push("image");
  if ([".pdf"].includes(ext)) tags.push("pdf", "document");
  return [...new Set(tags)].slice(0, 8);
}

// write buffer to temp file
function writeBufferToTemp(buffer, originalName) {
  const ext = path.extname(originalName) || "";
  const name = crypto.randomBytes(12).toString("hex") + ext;
  const tmpPath = path.join(os.tmpdir(), name);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}
function safeUnlink(p) { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {} }

// thumbnail generator
async function makeThumbnail(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buf = await sharp(filePath).resize(380, 260, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
    return "data:image/jpeg;base64," + buf.toString("base64");
  } catch (err) {
    console.warn("Thumbnail failed:", err && err.message);
    return null;
  }
}

// extract text helpers
async function extractTextFromPdfBuffer(buffer) {
  try {
    const data = await pdf(buffer);
    if (data && data.text && data.text.trim().length > 10) return data.text;
    const tmp = writeBufferToTemp(buffer, "tmp.pdf");
    try {
      const res = await Tesseract.recognize(tmp, "eng", { logger: () => {} });
      return res?.data?.text || "";
    } finally { safeUnlink(tmp); }
  } catch (e) {
    const tmp = writeBufferToTemp(buffer, "tmp.pdf");
    try {
      const res = await Tesseract.recognize(tmp, "eng", { logger: () => {} });
      return res?.data?.text || "";
    } finally { safeUnlink(tmp); }
  }
}
async function extractTextFromImagePath(p) {
  try {
    const res = await Tesseract.recognize(p, "eng", { logger: () => {} });
    return res?.data?.text || "";
  } catch (e) {
    return "";
  }
}
async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".pdf") {
      const buffer = fs.readFileSync(filePath);
      return await extractTextFromPdfBuffer(buffer);
    }
    if ([".txt", ".md", ".csv", ".log"].includes(ext)) {
      return fs.readFileSync(filePath, "utf8");
    }
    if ([".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp"].includes(ext)) {
      return await extractTextFromImagePath(filePath);
    }
    return "";
  } catch (e) {
    return "";
  }
}

// recursive directory walk (sync for simplicity)
function walkSync(dir, out = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) walkSync(p, out);
        else if (e.isFile()) out.push(p);
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

// attempt to load IndexedFile model if present
let IndexedFile = null;
try {
  IndexedFile = require(path.join(__dirname, "..", "models", "IndexedFile"));
} catch (e) {
  // model not present — we will fallback to JSON file
  IndexedFile = null;
}

async function connectMongoIfConfigured() {
  const MONGO_URI = process.env.MONGO_URI || "";
  if (!MONGO_URI) return false;
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("Connected to MongoDB for indexing.");
    return true;
  } catch (e) {
    console.warn("Failed to connect to MongoDB:", e && e.message);
    return false;
  }
}

async function upsertIndexedFile(entry) {
  // entry is sanitized (no internal fields)
  if (DRY) {
    console.log("[dry] upsert:", entry.path);
    return;
  }
  if (IndexedFile && mongoose.connection.readyState === 1) {
    try {
      await IndexedFile.updateOne({ path: entry.path }, { $set: entry }, { upsert: true });
      return;
    } catch (e) {
      console.warn("DB upsert failed for", entry.path, e.message || e);
      return;
    }
  } else {
    // fallback: accumulate in JSON
    let arr = [];
    if (fs.existsSync(OUT_JSON)) {
      try { arr = JSON.parse(fs.readFileSync(OUT_JSON, "utf8") || "[]"); } catch (e) { arr = []; }
    }
    // replace existing by path
    const idx = arr.findIndex((x) => x.path === entry.path);
    if (idx >= 0) arr[idx] = entry;
    else arr.push(entry);
    fs.writeFileSync(OUT_JSON, JSON.stringify(arr, null, 2), "utf8");
  }
}

async function main() {
  console.log("Indexer starting. options:", { SCAN_PATH, REBUILD, LIMIT, DRY });

  // Decide path to scan
  let scanRoot = SCAN_PATH;
  if (!scanRoot) {
    // try to find allowed root automatically
    if (ALLOWED_ROOTS && ALLOWED_ROOTS.length > 0) scanRoot = ALLOWED_ROOTS[0];
  }
  if (!scanRoot) {
    console.error("No --path provided and no ALLOWED_ROOTS configured. Provide --path to scan.");
    process.exit(1);
  }
  if (!isPathAllowed(scanRoot)) {
    console.error("Provided path is not allowed by ALLOWED_ROOTS:", scanRoot);
    process.exit(1);
  }
  if (!fs.existsSync(scanRoot) || !fs.statSync(scanRoot).isDirectory()) {
    console.error("Scan path does not exist or is not a directory:", scanRoot);
    process.exit(1);
  }

  // Try connect to mongo if model available
  let mongoReady = false;
  if (IndexedFile) {
    mongoReady = await connectMongoIfConfigured();
    if (!mongoReady) {
      console.log("IndexedFile model present but Mongo not reachable — will write JSON fallback to", OUT_JSON);
    } else if (REBUILD) {
      try {
        await IndexedFile.deleteMany({});
        console.log("Dropped existing IndexedFile collection (rebuild).");
      } catch (e) {
        console.warn("Failed to drop collection:", e && e.message);
      }
    }
  }

  // Walk files
  const allFiles = walkSync(scanRoot);
  console.log("Found files:", allFiles.length);
  const candidates = [];
  for (const p of allFiles) {
    try {
      const st = fs.statSync(p);
      const ext = path.extname(p).toLowerCase();
      const isImg = IMAGE_EXTS.has(ext);
      const isDoc = DOC_EXTS.has(ext);
      if (!isImg && !isDoc) continue;
      candidates.push({ path: p, sizeBytes: st.size, mtime: st.mtimeMs, isImg, ext });
      if (candidates.length >= LIMIT) break;
    } catch (_) {}
  }

  console.log("Candidates (after filtering):", candidates.length);

  // We'll process up to N items but extract text only for documents + first X images to keep load bounded
  const EXTRACT_LIMIT = Math.min(200, Math.floor(LIMIT / 4)); // safe default
  let processed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const st = fs.statSync(c.path);
      const name = path.basename(c.path);
      const human = humanSize(st.size);
      const mtime = new Date(st.mtimeMs).toISOString().replace("T", " ").slice(0, 16);
      const type = c.isImg ? "image" : (c.ext ? c.ext.replace(".", "") : "document");
      const tags = c.isImg ? heuristicTagsForPath(c.path) : heuristicTagsForPath(c.path);

      // prepare sanitized entry
      const entry = {
        name,
        path: c.path,
        thumbnailUrl: null,
        size: human,
        mtime,
        type,
        tags,
        extractText: "",
      };

      // thumbnail for images
      if (c.isImg) {
        try {
          entry.thumbnailUrl = await makeThumbnail(c.path);
        } catch (e) { entry.thumbnailUrl = null; }
      }

      // decide whether to run heavy extraction: run for docs always, for first EXTRACT_LIMIT images
      const shouldExtract = (!c.isImg) || (i < EXTRACT_LIMIT);
      if (shouldExtract) {
        try {
          const txt = await extractTextFromFile(c.path);
          entry.extractText = (txt || "").slice(0, 20000); // cap size
        } catch (e) {
          entry.extractText = "";
        }
      }

      // persist (DB or JSON)
      await upsertIndexedFile(entry);

      processed++;
      if (processed % 50 === 0) {
        console.log("Processed:", processed);
      }
    } catch (e) {
      // ignore single-file failures
      console.warn("File processing failed:", c.path, e && e.message);
    }
  }

  console.log("Indexing complete. processed:", processed);

  // close mongoose if connected
  try {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log("Mongo disconnected.");
    }
  } catch (e) {}

  console.log("Done.");
}

// run
main().catch((err) => {
  console.error("Indexer failed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
