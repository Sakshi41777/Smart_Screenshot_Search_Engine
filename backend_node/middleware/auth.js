require("dotenv").config();
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const JWT_SECRET = process.env.JWT_SECRET || "secret";

module.exports = function (req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ ok: false, message: "Missing Authorization header" });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ ok: false, message: "Invalid Authorization format" });
  }

  const token = parts[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    // DO NOT force ObjectId conversion unless it is valid
    if (typeof payload.id === "string" && /^[a-fA-F0-9]{24}$/.test(payload.id)) {
      payload.id = new mongoose.Types.ObjectId(payload.id);
    }

    req.user = payload;
    next();
  } catch (err) {
    console.error("JWT verify error:", err.message);
    return res.status(401).json({ ok: false, message: "Invalid or expired token" });
  }
};
