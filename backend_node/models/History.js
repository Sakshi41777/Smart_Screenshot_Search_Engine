const mongoose = require("mongoose");

const HistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Search query (can be empty)
    query: {
      type: String,
      default: "",
      trim: true,
    },

    // Normalized query key for grouping/upsert
    queryKey: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    // Folder path searched
    path: {
      type: String,
      default: "",
      trim: true,
    },

    // Optional: store filters for future analytics
    filters: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true, // createdAt & updatedAt
  }
);

// Fast per-user recent history
HistorySchema.index({ userId: 1, createdAt: -1 });
HistorySchema.index({ userId: 1, queryKey: 1, updatedAt: -1 });

module.exports = mongoose.model("History", HistorySchema);
