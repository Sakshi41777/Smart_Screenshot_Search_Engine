// backend_node/routes/searchProgress.js
const express = require("express");
const router = express.Router();

/**
 * Active SSE clients
 */
let clients = [];

/**
 * GET /api/search/progress
 * Electron renderer listens using EventSource
 */
router.get("/progress", (req, res) => {
  // 🔥 REQUIRED SSE HEADERS
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // VERY IMPORTANT for Windows / Node 18+
  if (res.flushHeaders) {
    res.flushHeaders();
  }

  // initial ping (keeps connection alive)
  res.write(
    `data: ${JSON.stringify({
      stage: "idle",
      message: "Connected",
      ts: Date.now(),
    })}\n\n`
  );

  const clientId = Date.now() + Math.random();
  const client = { id: clientId, res };
  clients.push(client);

  // 🔥 clean disconnect
  req.on("close", () => {
    clients = clients.filter((c) => c.id !== clientId);
  });
});

/**
 * Broadcast progress updates
 */
function sendProgress(message, stage = "working") {
  const payload = JSON.stringify({
    stage,
    message,
    ts: Date.now(),
  });

  clients = clients.filter((client) => {
    try {
      client.res.write(`data: ${payload}\n\n`);
      return true;
    } catch (err) {
      return false; // remove dead connection
    }
  });
}

module.exports = {
  router,
  sendProgress,
};
