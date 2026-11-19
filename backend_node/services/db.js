const mongoose = require("mongoose");

// How long a request may wait for the database while the app is starting.
const DB_WAIT_MS = 30000;

function isDbReady() {
  return mongoose.connection.readyState === 1;
}

// Resolves true as soon as the database is connected, or false after maxMs.
function waitForDb(maxMs = DB_WAIT_MS) {
  if (isDbReady()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (isDbReady()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started >= maxMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 250);
  });
}

// While the app is starting, requests wait for the database instead of failing.
async function requireDb(req, res, next) {
  if (isDbReady() || (await waitForDb())) return next();
  return res.status(503).json({
    ok: false,
    message: "The database isn't ready yet. Close the app and open it again.",
  });
}

module.exports = {
  isDbReady,
  waitForDb,
  requireDb,
};
