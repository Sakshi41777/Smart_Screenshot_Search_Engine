// backend_node/models/SavedItem.js
const mongoose = require("mongoose");

const { Schema } = mongoose;

const SavedItemSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    path: {
      type: String,
      required: true,
      index: true,
    },

    thumbnailUrl: {
      type: String,
      default: "",
    },

    tags: {
      type: [String],
      default: [],
    },

    type: {
      type: String,
      default: "image",
    },

    score: {
      type: Number,
      default: null,
    },

    sizeBytes: {
      type: Number,
      default: null,
    },

    mtime: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Optional but useful:
 * prevent same user from saving same file path repeatedly
 */
SavedItemSchema.index(
  { userId: 1, path: 1 },
  { unique: false }
);

// ✅ SAFE EXPORT (prevents OverwriteModelError)
module.exports =
  mongoose.models.SavedItem ||
  mongoose.model("SavedItem", SavedItemSchema);
