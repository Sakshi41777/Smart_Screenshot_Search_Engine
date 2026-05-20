const mongoose = require("mongoose");

const IndexedFileSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // 🔑 LOGICAL (PC-RELATIVE) PATH
    path: {
      type: String,
      required: true,
      index: true, // ❌ removed unique to avoid silent failures
    },
    // Normalized path key for de-duplication (lowercased, trimmed, absolute if possible).
    pathKey: {
      type: String,
      default: "",
      index: true,
    },

    type: {
      type: String,
      enum: ["image", "document"],
      default: "image",
      index: true,
    },

    // ✅ FIXED FIELD NAME (used everywhere)
    extractedText: {
      type: String,
      default: "",
    },

    sizeKB: {
      type: Number,
      default: 0,
      index: true,
    },

    // Source file signature for incremental indexing.
    sourceSizeBytes: {
      type: Number,
      default: null,
      index: true,
    },

    sourceMtimeMs: {
      type: Number,
      default: null,
      index: true,
    },

    fileHash: {
      type: String,
      default: null,
      index: true,
    },

    imageHash: {
      type: String,
      default: null,
      index: true,
    },

    semanticVector: {
      type: [Number],
      default: undefined,
    },

    semanticModel: {
      type: String,
      default: "",
    },

    // CLIP image embedding for visual-semantic search
    imageVector: {
      type: [Number],
      default: undefined,
    },

    imageModel: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
    autoIndex: true, // ✅ REQUIRED for text search to work
  }
);

/* =========================
   🔍 FULL-TEXT SEARCH INDEX
========================= */
IndexedFileSchema.index(
  {
    name: "text",
    extractedText: "text",
    path: "text",
  },
  {
    weights: {
      name: 10,          // filename matters most
      extractedText: 5,  // OCR text
      path: 2,           // folder context
    },
    name: "GlobalSearchIndex",
  }
);

module.exports = mongoose.model("IndexedFile", IndexedFileSchema);
