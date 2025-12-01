const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "secret";

module.exports = function(req, res, next){
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: "Missing auth token" });
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return res.status(401).json({ message: "Invalid auth format" });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch(err){
    return res.status(401).json({ message: "Invalid / expired token" });
  }
};
