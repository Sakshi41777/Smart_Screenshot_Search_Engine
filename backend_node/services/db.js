const mongoose = require("mongoose");

function isDbReady() {
  return mongoose.connection.readyState === 1;
}

function requireDb(req, res, next) {
  if (isDbReady()) return next();
  return res.status(503).json({
    ok: false,
    message:
      "Database not connected. Start MongoDB and restart the backend.",
  });
}

module.exports = {
  isDbReady,
  requireDb,
};
