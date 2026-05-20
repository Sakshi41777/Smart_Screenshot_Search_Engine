const mongoose = require("mongoose");

<<<<<<< HEAD
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
=======
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", UserSchema);
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
