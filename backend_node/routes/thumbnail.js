const express = require("express");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const crypto = require("crypto");

const router = express.Router();
const BAD_THUMB_FILES = new Set();

/* =========================
   THUMB CACHE
========================= */
const THUMB_DIR = path.join(__dirname, "..", "thumb_cache");
if (!fs.existsSync(THUMB_DIR)) {
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

/* =========================
   GET /api/thumbnail
========================= */
router.get("/", async (req, res) => {
  try {
    if (!req.query.path) {
      return res.status(400).send("Missing path");
    }

    // ✅ decode URL-encoded path
    let filePath = decodeURIComponent(req.query.path);

    // ✅ resolve relative paths (uploads)
    if (!path.isAbsolute(filePath)) {
      filePath = path.join(process.cwd(), filePath);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }

    if (BAD_THUMB_FILES.has(filePath)) {
      return res.status(415).send("Unsupported image data");
    }

    const ext = path.extname(filePath).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".bmp", ".webp"].includes(ext)) {
      return res.status(415).send("Unsupported file type");
    }

    // Full-resolution passthrough for modal preview zoom.
    if (String(req.query.raw || "") === "1") {
      return res.sendFile(path.resolve(filePath));
    }

    // Use fixed-length hash for Windows-safe cache filenames.
    const hash = crypto.createHash("sha1").update(filePath).digest("hex");

    const thumbPath = path.join(THUMB_DIR, `${hash}.jpg`);

    // ♻️ serve cached thumbnail
    if (fs.existsSync(thumbPath)) {
      return res.sendFile(path.resolve(thumbPath));
    }

    // 🔥 generate thumbnail
    const meta = await sharp(filePath).metadata();
    if (!meta?.width || !meta?.height || !meta?.format) {
      BAD_THUMB_FILES.add(filePath);
      return res.status(415).send("Unsupported image data");
    }

    try {
      await sharp(filePath)
        .resize(240, 240, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toFile(thumbPath);
    } catch (cacheErr) {
      // If writing cache fails, still return thumbnail bytes to client.
      const buffer = await sharp(filePath)
        .resize(240, 240, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
      res.type("image/jpeg");
      return res.send(buffer);
    }

    return res.sendFile(path.resolve(thumbPath));
  } catch (err) {
    if (
      String(err?.message || "").toLowerCase().includes("unsupported image format")
    ) {
      try {
        let badPath = decodeURIComponent(req.query.path || "");
        if (badPath && !path.isAbsolute(badPath)) {
          badPath = path.join(process.cwd(), badPath);
        }
        if (badPath) BAD_THUMB_FILES.add(badPath);
      } catch {}
      return res.status(415).send("Unsupported image data");
    }

    console.error("❌ Thumbnail error:", err.message);
    res.status(500).send("Thumbnail failed");
  }
});

module.exports = router;
