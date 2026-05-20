// backend_node/workers/indexer.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const IndexedFile = require("../models/IndexedFile");
const { sendProgress } = require("../routes/searchProgress");

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"]);
const DOC_EXTS = new Set([".pdf", ".doc", ".docx", ".txt"]);

function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return bytes + " B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ["B", "KB", "MB", "GB"][i];
}

async function makeThumbnail(filePath) {
  try {
    const buf = await sharp(filePath)
      .resize(320, 240, { fit: "inside" })
      .jpeg({ quality: 65 })
      .toBuffer();
    return "data:image/jpeg;base64," + buf.toString("base64");
  } catch {
    return null;
  }
}

function walk(dir, out = []) {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.isFile()) out.push(p);
    }
  } catch {}
  return out;
}

let running = false;

/**
 * Start background indexing (idempotent)
 */
async function startIndexing(rootFolder) {
  if (running) return;
  running = true;

  sendProgress("Indexing started");

  const files = walk(rootFolder);
  let indexed = 0;

  for (const p of files) {
    try {
      const ext = path.extname(p).toLowerCase();
      const isImg = IMAGE_EXTS.has(ext);
      const isDoc = DOC_EXTS.has(ext);
      if (!isImg && !isDoc) continue;

      const exists = await IndexedFile.exists({ path: p });
      if (exists) continue;

      const st = fs.statSync(p);

      const record = new IndexedFile({
        name: path.basename(p),
        path: p,
        thumbnailUrl: isImg ? await makeThumbnail(p) : null,
        size: humanSize(st.size),
        mtime: st.mtime.toISOString(),
        type: isImg ? "image" : "document",
        tags: [],
        extractText: "",
      });

      await record.save();
      indexed++;

      if (indexed % 25 === 0) {
        sendProgress(`Indexed ${indexed} files`);
      }
    } catch {
      // ignore single file failures
    }
  }

  sendProgress(`Indexing complete (${indexed} files)`);
  running = false;
}

module.exports = { startIndexing };
