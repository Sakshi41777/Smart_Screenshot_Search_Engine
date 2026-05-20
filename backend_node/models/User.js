const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true
    },
    password: { type: String },
    passwordHash: { type: String },
    googleId: { type: String },
    emailVerified: { type: Boolean, default: false },
    emailVerifyToken: { type: String },
    emailVerifyExpires: { type: Date },
    guest: { type: Boolean, default: false }
  },
  { timestamps: true }
);


module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
