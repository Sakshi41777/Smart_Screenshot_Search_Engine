require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const { startMaintenanceScheduler } = require("./services/maintenance");

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

const app = express();

const PORT = Number(process.env.PORT || 5001);
// Only this computer can reach the backend (it serves the user's files).
const HOST = process.env.HOST || "127.0.0.1";
const MONGO_URI = process.env.MONGO_URI || "";
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "";
const ALLOW_ANY_ORIGIN =
  String(process.env.ALLOW_ANY_ORIGIN || "false").toLowerCase() === "true";
const allowedOrigins = new Set(
  [CLIENT_ORIGIN].filter(Boolean)
);

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log("uploads/ directory created");
}

app.use(
  cors({
    origin(origin, callback) {
      if (ALLOW_ANY_ORIGIN) return callback(null, true);
      const safeOrigin = String(origin || "");
      const isFileOrigin =
        safeOrigin.startsWith("file://") || safeOrigin.startsWith("app://");
      if (!origin || safeOrigin === "null") {
        return callback(null, true);
      }
      if (isFileOrigin) {
        return callback(null, safeOrigin);
      }
      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: false,
    methods: ["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const historyRoutes = require("./routes/history");
const itemsRoutes = require("./routes/items");
const searchRoutes = require("./routes/search");
const { router: progressRouter } = require("./routes/searchProgress");
const thumbnailRoutes = require("./routes/thumbnail");
const settingsRoutes = require("./routes/settings");

app.get("/health", (_, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/search/history", historyRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/search", progressRouter);
app.use("/api/search", searchRoutes);
app.use("/api/items", itemsRoutes);
app.use("/api/saved", itemsRoutes);
app.use("/api/thumbnail", thumbnailRoutes);
app.use("/api/settings", settingsRoutes);

// The desktop app asks for a clean database shutdown when it quits, so the
// database never needs crash recovery on the next start.
app.post("/internal/shutdown-db", async (req, res) => {
  const token = process.env.SMARTSHOT_INTERNAL_TOKEN;
  if (!token || req.get("x-internal-token") !== token) {
    return res.status(403).json({ ok: false });
  }
  res.json({ ok: true });
  try {
    await mongoose.connection.db.admin().command({ shutdown: 1 });
  } catch {
    // mongod closes the connection while shutting down; that's expected.
  }
});

async function connectMongoWithRetry(uri, attempts = 30, delayMs = 2000) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await mongoose.connect(uri, { autoIndex: true, serverSelectionTimeoutMS: 4000 });
      console.log("MongoDB connected");
      return true;
    } catch (err) {
      console.error(`MongoDB not ready (attempt ${i}/${attempts}):`, err.message);
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

async function start() {
  // Start answering right away (health check passes quickly); routes that
  // need the database reply "not ready" until the connection below succeeds.
  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the other backend process or set a different PORT in backend_node/.env.`
      );
      process.exit(1);
    }

    console.error("Server error:", err.message);
    process.exit(1);
  });

  server.on("clientError", (err) => {
    if (
      err.code === "ECONNRESET" ||
      err.code === "ECONNABORTED" ||
      err.code === "EPIPE" ||
      String(err.message || "").toLowerCase().includes("aborted")
    ) {
      return;
    }
    console.error("Client error:", err.message);
  });

  if (MONGO_URI) {
    const ok = await connectMongoWithRetry(MONGO_URI);
    if (!ok) console.error("MongoDB error: could not connect");
  } else {
    console.warn("MONGO_URI not set");
  }

  startMaintenanceScheduler({ logger: console });
}

start();
