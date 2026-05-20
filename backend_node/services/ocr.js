const Tesseract = require("tesseract.js");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const sharp = require("sharp");
const axios = require("axios");
const FormData = require("form-data");

/* ================= CONFIG ================= */
const OCR_TIMEOUT_MS = 20_000; // hard timeout
const MAX_TEXT_LEN = 20_000;
const MIN_OCR_SIDE = 96;
const AI_OCR_FALLBACK = String(process.env.AI_OCR_FALLBACK || "false").toLowerCase() === "true";
const AI_OCR_TIMEOUT_MS = Number(process.env.AI_OCR_TIMEOUT_MS || 12_000);
const AI_OCR_MIN_TEXT_LEN = Number(process.env.AI_OCR_MIN_TEXT_LEN || 18);

const LLM_PROVIDER = String(process.env.LLM_PROVIDER || "openai").toLowerCase();
const VISION_PROVIDER = String(process.env.VISION_PROVIDER || LLM_PROVIDER).toLowerCase();
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const OPENAI_BASE_URL = (process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
const GEMINI_BASE_URL = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const LOCAL_VISION_URL = String(process.env.LOCAL_VISION_URL || "http://127.0.0.1:5055").replace(/\/+$/, "");
const OPENAI_FALLBACK_MODEL = String(process.env.OPENAI_FALLBACK_MODEL || "gpt-4o-mini").trim();

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

// ⚠️ Only formats stable on Windows
const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".bmp",
  ".webp",
  ".gif",
]);

const TEXT_EXTS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".log",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".go",
  ".rs",
  ".php",
  ".rb",
  ".swift",
  ".kt",
  ".kts",
  ".sql",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".cfg",
  ".env",
  ".sh",
  ".bat",
  ".ps1",
  ".dockerfile",
  ".gitignore",
]);

function isSupportedImageExt(ext = "") {
  return IMAGE_EXTS.has(String(ext || "").toLowerCase());
}

function isReadableImageMeta(meta) {
  return Boolean(meta && meta.width && meta.height && meta.format);
}

function isTooTinyForOcr(meta) {
  const w = Number(meta?.width || 0);
  const h = Number(meta?.height || 0);
  // Leptonica scaling can error on ultra-thin images (< 4px on any side).
  return w < 4 || h < 4;
}

/* ================= HELPERS ================= */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("OCR timeout")), ms)
    ),
  ]);
}

function textLooksUseful(text = "") {
  const clean = String(text || "").trim();
  if (!clean) return false;
  if (clean.length < AI_OCR_MIN_TEXT_LEN) return false;
  const letters = (clean.match(/[a-zA-Z]/g) || []).length;
  return letters >= 6;
}

async function recognizeWithPsm(inputBuffer, psm = "6") {
  const result = await withTimeout(
    Tesseract.recognize(inputBuffer, "eng", {
      logger: () => {},
      tessedit_pageseg_mode: String(psm),
      preserve_interword_spaces: "1",
      tessedit_char_blacklist: "|`~^",
    }),
    OCR_TIMEOUT_MS
  );
  return (result?.data?.text || "").slice(0, MAX_TEXT_LEN);
}

async function askVisionWithProvider(imageBuffer) {
  const prompt =
    "Extract visible text from this image. If readable text is limited, provide a short, human-meaningful description of the image content. Return plain text only.";
  const textModel = getPrimaryLlmModel();

  if (VISION_PROVIDER === "local") {
    try {
      const form = new FormData();
      form.append("image", imageBuffer, {
        filename: "image.png",
        contentType: "image/png",
      });
      const resp = await axios.post(`${LOCAL_VISION_URL}/caption`, form, {
        headers: form.getHeaders(),
        timeout: AI_OCR_TIMEOUT_MS,
      });
      return String(resp?.data?.text || "").slice(0, MAX_TEXT_LEN).trim();
    } catch {
      return "";
    }
  }

  if (VISION_PROVIDER === "gemini") {
    if (!GEMINI_API_KEY) return "";
    const resp = await axios.post(
      `${GEMINI_BASE_URL}/models/${encodeURIComponent(textModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "image/png",
                  data: imageBuffer.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.1 },
      },
      { timeout: AI_OCR_TIMEOUT_MS }
    );
    const parts = resp?.data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts.map((p) => p?.text || "").join("\n").slice(0, MAX_TEXT_LEN).trim();
  }

  if (!OPENAI_API_KEY) return "";
  for (const model of getOpenAiModelCandidates()) {
    try {
      const resp = await axios.post(
        `${OPENAI_BASE_URL}/chat/completions`,
        {
          model,
          temperature: 0.1,
          max_tokens: 350,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${imageBuffer.toString("base64")}`,
                  },
                },
              ],
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: AI_OCR_TIMEOUT_MS,
        }
      );

      return String(resp?.data?.choices?.[0]?.message?.content || "")
        .slice(0, MAX_TEXT_LEN)
        .trim();
    } catch (err) {
      if (err?.response?.status === 404) continue;
      throw err;
    }
  }

  return "";
}

async function describeImageSemanticSafe(filePath, options = {}) {
  try {
    if (!filePath) return "";
    if (!fs.existsSync(filePath)) return "";
    const ext = path.extname(filePath).toLowerCase();
    if (!isSupportedImageExt(ext)) return "";

    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) return "";

    const imageBuffer = fs.readFileSync(filePath);
    if (!imageBuffer || imageBuffer.length < 50) return "";

    let input = imageBuffer;
    try {
      // Normalize size/orientation before vision call for better consistency.
      input = await sharp(imageBuffer)
        .rotate()
        .resize({ width: 1400, withoutEnlargement: true, fit: "inside" })
        .png()
        .toBuffer();
    } catch {
      return "";
    }

    const prompt =
      String(options.prompt || "").trim() ||
      "Describe this image for file search. Return plain text with: people, clothing, colors, objects, scene, and any visible text keywords.";
    const textModel = getPrimaryLlmModel();

    if (VISION_PROVIDER === "local") {
      try {
        const form = new FormData();
        form.append("image", input, {
          filename: "image.png",
          contentType: "image/png",
        });
        const resp = await axios.post(`${LOCAL_VISION_URL}/caption`, form, {
          headers: form.getHeaders(),
          timeout: AI_OCR_TIMEOUT_MS,
        });
        const text = String(resp?.data?.text || "").trim();
        return text.slice(0, MAX_TEXT_LEN);
      } catch {
        return "";
      }
    }

    if (VISION_PROVIDER === "gemini") {
      if (!GEMINI_API_KEY) return "";
      const resp = await axios.post(
        `${GEMINI_BASE_URL}/models/${encodeURIComponent(textModel)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
        {
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: "image/png",
                    data: input.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.1 },
        },
        { timeout: AI_OCR_TIMEOUT_MS }
      );
      const parts = resp?.data?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts)
        ? parts.map((p) => p?.text || "").join("\n")
        : "";
      return String(text || "").slice(0, MAX_TEXT_LEN).trim();
    }

    if (!OPENAI_API_KEY) return "";
    for (const model of getOpenAiModelCandidates()) {
      try {
        const resp = await axios.post(
          `${OPENAI_BASE_URL}/chat/completions`,
          {
            model,
            temperature: 0.1,
            max_tokens: 260,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${input.toString("base64")}`,
                    },
                  },
                ],
              },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: AI_OCR_TIMEOUT_MS,
          }
        );
        return String(resp?.data?.choices?.[0]?.message?.content || "")
          .slice(0, MAX_TEXT_LEN)
          .trim();
      } catch (err) {
        if (err?.response?.status === 404) continue;
        throw err;
      }
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * SAFE OCR
 * - never throws
 * - never crashes server
 * - always returns string
 */
async function extractTextSafe(filePath, options = {}) {
  try {
    if (!filePath) return "";
    if (!fs.existsSync(filePath)) return "";

    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return "";

    const ext = path.extname(filePath).toLowerCase();

    /* ---------- TEXT / CODE FILES ---------- */
    if (TEXT_EXTS.has(ext)) {
      return fs
        .readFileSync(filePath, "utf8")
        .slice(0, MAX_TEXT_LEN);
    }

    /* ---------- PDF (TEXT ONLY) ---------- */
    if (ext === ".pdf") {
      try {
        const buffer = fs.readFileSync(filePath);
        const data = await withTimeout(
          pdfParse(buffer),
          OCR_TIMEOUT_MS
        );

        if (data?.text && data.text.trim().length > 20) {
          return data.text.slice(0, MAX_TEXT_LEN);
        }
      } catch {
        return "";
      }
      return "";
    }

    /* ---------- IMAGE OCR ---------- */
    if (!IMAGE_EXTS.has(ext)) return "";

    // Read as buffer (prevents pixReadStream crashes)
    const imageBuffer = fs.readFileSync(filePath);
    if (!imageBuffer || imageBuffer.length < 50) return "";

    let ocrInput = imageBuffer;
    let ocrHighContrastInput = null;
    try {
      // Preprocess screenshot-like images to improve text readability for OCR.
      // Upscaling helps tiny UI fonts become OCR-readable.
      const meta = await sharp(imageBuffer).metadata();
      if (!isReadableImageMeta(meta)) return "";
      if (isTooTinyForOcr(meta)) return "";

      const baseWidth = Number(meta?.width || 0);
      const baseHeight = Number(meta?.height || 0);
      const targetWidth = baseWidth > 0 && baseWidth < 1600 ? 1600 : baseWidth;
      const needsMinPad = baseWidth < MIN_OCR_SIDE || baseHeight < MIN_OCR_SIDE;

      let pipeline = sharp(imageBuffer).rotate();

      if (needsMinPad) {
        // Pad small images before OCR to avoid tiny intermediate pix buffers.
        pipeline = pipeline.resize({
          width: Math.max(baseWidth, MIN_OCR_SIDE),
          height: Math.max(baseHeight, MIN_OCR_SIDE),
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 1 },
          withoutEnlargement: false,
        });
      }

      if (targetWidth && targetWidth !== baseWidth) {
        pipeline = pipeline.resize({
          width: targetWidth,
          withoutEnlargement: false,
          fit: "inside",
        });
      }

      ocrInput = await pipeline
        .grayscale()
        .normalize()
        .sharpen({ sigma: 1.4 })
        .linear(1.15, -10)
        .png({ density: 72 })
        .toBuffer();

      // Additional high-contrast variant improves OCR for dim screenshots/photos.
      ocrHighContrastInput = await sharp(ocrInput)
        .threshold(155)
        .median(1)
        .png({ density: 72 })
        .toBuffer();
    } catch {
      // If sharp cannot decode/process image, do not send raw buffer to OCR.
      // Raw malformed images can crash OCR workers.
      return "";
    }

    // Multi-pass OCR with different page segmentation modes.
    let bestText = "";
    try {
      const pass1 = await recognizeWithPsm(ocrInput, "6"); // block text
      if (textLooksUseful(pass1)) return pass1;
      bestText = pass1 || "";
    } catch {}

    try {
      const pass2 = await recognizeWithPsm(ocrInput, "11"); // sparse text
      if ((pass2 || "").length > bestText.length) bestText = pass2;
      if (textLooksUseful(pass2)) return pass2;
    } catch {}

    if (ocrHighContrastInput) {
      try {
        const pass3 = await recognizeWithPsm(ocrHighContrastInput, "6");
        if ((pass3 || "").length > bestText.length) bestText = pass3;
        if (textLooksUseful(pass3)) return pass3;
      } catch {}
    }

    const shouldUseAiFallback = Boolean(options.forceAiFallback) || AI_OCR_FALLBACK;

    // Optional AI fallback for hard images (disabled by default to control cost).
    if (shouldUseAiFallback) {
      try {
        const aiText = await askVisionWithProvider(ocrInput);
        if (textLooksUseful(aiText) || (aiText || "").length > (bestText || "").length) {
          return aiText.slice(0, MAX_TEXT_LEN);
        }
      } catch {}
    }

    return (bestText || "").slice(0, MAX_TEXT_LEN);

  } catch (err) {
    console.warn("[OCR SKIPPED]", path.basename(filePath));
    return "";
  }
}

module.exports = {
  extractTextSafe, // ✅ explicit safe name
  describeImageSemanticSafe,
};
