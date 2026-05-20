const mongoose = require("mongoose");

const SearchSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  query: { type: String, required: true },
  snippet: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Search", SearchSchema);
