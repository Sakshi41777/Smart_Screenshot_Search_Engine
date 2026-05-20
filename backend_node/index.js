require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
<<<<<<< HEAD
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

async function start() {
  if (MONGO_URI) {
    try {
      await mongoose.connect(MONGO_URI, { autoIndex: true });
      console.log("MongoDB connected");
    } catch (err) {
      console.error("MongoDB error:", err.message);
      process.exit(1);
    }
  } else {
    console.warn("MONGO_URI not set");
  }

  startMaintenanceScheduler({ logger: console });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
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
}

start();
=======

const authRoutes = require("./routes/auth");
const searchRoutes = require("./routes/search");
const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/search", searchRoutes);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI, { })
  .then(()=> {
    console.log("MongoDB connected");
    app.listen(PORT, ()=> console.log(`Server listening on ${PORT}`));
  })
  .catch(err => {
    console.error("Mongo connect error:", err);
    process.exit(1);
  });
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
