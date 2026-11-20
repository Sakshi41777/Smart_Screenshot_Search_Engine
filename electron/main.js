const { app, BrowserWindow, dialog, ipcMain, shell, clipboard, nativeImage, Tray, Menu, powerMonitor } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile, spawn } = require("child_process");

// ---------------------------------------------------------------------------
//  single‑instance helpers
// ---------------------------------------------------------------------------
// ensure only one instance is active; if someone tries to start a second
// copy (for example during an install), the primary instance will receive
// the `second-instance` event with the second process argv. We use that to
// support a graceful shutdown when the installer launches the exe with
// `--shutdown`.
// The running copy writes a "heartbeat" file every few seconds. If a new launch
// finds that the running copy has stopped responding, it closes the stuck copy
// and starts fresh, so users never have to open Task Manager.
const HEARTBEAT_MS = 5000;
const HEARTBEAT_STALE_MS = 30000;

function heartbeatFile() {
  try {
    return path.join(app.getPath("userData"), "instance-heartbeat.json");
  } catch {
    return "";
  }
}

function readHeartbeat() {
  try {
    const file = heartbeatFile();
    if (!file || !fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || !Number.isFinite(data.pid) || !Number.isFinite(data.beat)) return null;
    return data;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === "EPERM");
  }
}

// Only ever close a process that is really this app (Windows can reuse old
// process numbers for other programs).
function isOurProcess(pid) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(false);
    execFile(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(false);
        const name = (String(stdout).split(",")[0] || "").replace(/"/g, "").trim().toLowerCase();
        resolve(Boolean(name) && name === path.win32.basename(process.execPath).toLowerCase());
      }
    );
  });
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function forceKillPid(pid) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      try { process.kill(pid, "SIGKILL"); } catch {}
      return resolve();
    }
    execFile("taskkill", ["/F", "/PID", String(pid), "/T"], { windowsHide: true }, () => resolve());
  });
}

function killOwnMongo() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve();
    execFile("taskkill", ["/F", "/IM", "smartshot-mongod.exe", "/T"], { windowsHide: true }, () => resolve());
  });
}

// Runs in a second launch when another copy already holds the lock.
async function recoverFromStuckInstance(argv) {
  if (argv.includes("--shutdown")) return false;
  let hb = readHeartbeat();
  if (!hb || hb.pid === process.pid || !isPidAlive(hb.pid)) return false;
  if (Date.now() - hb.beat < HEARTBEAT_STALE_MS) return false; // running copy is healthy

  // The heartbeat may only be old because the PC just woke from sleep.
  // A healthy copy writes a new one within a few seconds, so wait and re-check.
  await waitMs(HEARTBEAT_MS + 3000);
  hb = readHeartbeat();
  if (!hb || !isPidAlive(hb.pid)) return true; // it exited by itself; start fresh
  if (Date.now() - hb.beat < HEARTBEAT_STALE_MS) return false;
  if (!(await isOurProcess(hb.pid))) return false;

  try { writeMainLog("previous copy stopped responding; closing it", { pid: hb.pid }); } catch {}
  await forceKillPid(hb.pid);
  await killOwnMongo();
  try { fs.unlinkSync(heartbeatFile()); } catch {}
  await waitMs(1500);
  return true;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  recoverFromStuckInstance(process.argv)
    .catch(() => false)
    .then((restart) => {
      if (restart) app.relaunch();
      app.exit(0);
    });
} else {
  app.on("second-instance", (event, argv) => {
    try { writeMainLog('second-instance received', argv); } catch {}
    try {
      if (Array.isArray(argv) && argv.includes("--shutdown")) {
        // Installer requested the running instance to exit.
        try { writeMainLog('installer requested shutdown via --shutdown'); } catch {}
        isQuitting = true;
        app.quit();
        return;
      }
    } catch {}

    showMainWindow();
  });
}

// Shows the window, creating it if the app was running without one
// (started in the background at sign-in, or the window was closed).
function showMainWindow() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } catch (err) {
    try { writeMainLog("showMainWindow failed; creating a new window", err && err.message); } catch {}
    mainWindow = null;
    try { createWindow(); } catch {}
  }
}

function startHeartbeat() {
  const write = () => {
    try {
      const file = heartbeatFile();
      if (file) fs.writeFileSync(file, JSON.stringify({ pid: process.pid, beat: Date.now() }));
    } catch {}
  };
  write();
  const timer = setInterval(write, HEARTBEAT_MS);
  if (timer.unref) timer.unref();
}


let mainWindow;
let tray = null;
let isQuitting = false;
const iconPath = path.join(__dirname, "resources", "icon.ico");
const appUserModelId = "com.smartshot.desktop";
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || "http://127.0.0.1:5001";
const isDev = process.env.NODE_ENV === "development";
const BACKEND_HEALTH_URL = `${BACKEND_BASE_URL.replace(/\/+$/, "")}/health`;
// First launch after install can be slow: Windows Defender scans the
// backend's files before they load. Wait generously instead of failing.
const BACKEND_STARTUP_TIMEOUT_MS = 180000;
const WATCHER_DEBOUNCE_MS = 900;
// Built-in MongoDB (installed app): private port so it never clashes with a
// MongoDB the user may already run on 27017.
const EMBEDDED_MONGO_PORT = Number(process.env.SMARTSHOT_MONGO_PORT || 27027);
let mongoProcess = null;
// Lets only this app ask the backend to shut the database down cleanly on quit.
const INTERNAL_TOKEN = require("crypto").randomBytes(24).toString("hex");
let embeddedMongoUri = "";
let backendProcess = null;
let backendSpawnedByApp = false;
let backendLogPath = "";
let mainLogPath = "";
const watcherState = {
  running: false,
  watchers: new Map(),
  timers: new Map(),
  retryCounts: new Map(),
  queue: new Set(),
  processing: false,
  settings: null,
};

// Keep dev and installed app caches isolated to avoid Windows lock conflicts.
const cacheProfile = isDev ? "smart-screenshot-desktop-dev" : "smart-screenshot-desktop";
try {
  app.setPath("userData", path.join(app.getPath("appData"), cacheProfile));
  app.commandLine.appendSwitch(
    "disk-cache-dir",
    path.join(app.getPath("temp"), `${cacheProfile}-cache`)
  );
} catch {}

function getBackgroundSettingsPath() {
  return path.join(app.getPath("userData"), "background-index-settings.json");
}

function getBackendLogPath() {
  if (backendLogPath) return backendLogPath;
  try {
    backendLogPath = path.join(app.getPath("userData"), "backend.log");
  } catch {
    backendLogPath = path.join(os.tmpdir(), "smartshot-backend.log");
  }
  return backendLogPath;
}

function getMainLogPath() {
  if (mainLogPath) return mainLogPath;
  try {
    mainLogPath = path.join(app.getPath("userData"), "main.log");
  } catch {
    mainLogPath = path.join(os.tmpdir(), "smartshot-main.log");
  }
  return mainLogPath;
}

function writeMainLog(...parts) {
  try {
    const line = `[${new Date().toISOString()}] ${parts
      .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
      .join(" ")}\n`;
    const p = getMainLogPath();
    try {
      fs.appendFileSync(p, line, { encoding: "utf8" });
    } catch (err) {
      console.debug("Failed to write main log", err && err.message);
    }
  } catch {}
}

process.on('uncaughtException', (err) => {
  try { writeMainLog('uncaughtException', err && (err.stack || err.message)); } catch {}
});

process.on('unhandledRejection', (reason) => {
  try { writeMainLog('unhandledRejection', reason && (reason.stack || reason)); } catch {}
});

function resolveNodeBinary() {
  const explicit = String(process.env.BACKEND_NODE_PATH || "").trim();
  if (explicit && fs.existsSync(explicit)) return explicit;

  const pathEnv = String(process.env.PATH || "");
  const entries = pathEnv.split(path.delimiter).filter(Boolean);
  const binName = process.platform === "win32" ? "node.exe" : "node";
  for (const entry of entries) {
    const candidate = path.join(entry, binName);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {}
  }

  return "";
}

function normalizeFolderList(input = []) {
  return [...new Set((Array.isArray(input) ? input : [])
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .map((p) => {
      try {
        return path.resolve(p);
      } catch {
        return p;
      }
    }))];
}

function pathNormLower(p = "") {
  try {
    return path.resolve(String(p || "")).replace(/[\\/]+$/, "").toLowerCase();
  } catch {
    return String(p || "").trim().replace(/[\\/]+$/, "").toLowerCase();
  }
}

function pathInFolders(targetPath = "", folders = []) {
  const t = pathNormLower(targetPath);
  if (!t) return false;
  const roots = normalizeFolderList(folders);
  if (!roots.length) return false;
  return roots.some((root) => {
    const r = pathNormLower(root);
    return t === r || t.startsWith(`${r}\\`) || t.startsWith(`${r}/`);
  });
}

function defaultBackgroundSettings() {
  const home = os.homedir();
  const candidates = [
    app.getPath("documents"),
    app.getPath("downloads"),
    app.getPath("pictures"),
    app.getPath("desktop"),
    path.join(home, "OneDrive", "Documents"),
    path.join(home, "OneDrive", "Downloads"),
    path.join(home, "OneDrive", "Pictures"),
    path.join(home, "OneDrive", "Desktop"),
  ].filter(Boolean);

  const existing = normalizeFolderList(candidates).filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });

  return {
    consentGiven: false,
    enabled: false,
    strictPrivacy: false,
    keepRunningInTray: true,
    runAtStartup: true,
    useSpecificFolders: false,
    folders: existing.slice(0, 8),
  };
}

function getSystemWideWatchFolders() {
  const rows = [];
  try {
    const home = os.homedir();
    if (home) rows.push(home);
  } catch {}

  if (process.platform === "win32") {
    for (let i = 65; i <= 90; i += 1) {
      const drive = `${String.fromCharCode(i)}:\\`;
      try {
        if (fs.existsSync(drive) && fs.statSync(drive).isDirectory()) rows.push(drive);
      } catch {}
    }
  }

  return normalizeFolderList(rows).filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

function loadBackgroundSettings() {
  const filePath = getBackgroundSettingsPath();
  const fallback = defaultBackgroundSettings();
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const merged = {
      ...fallback,
      ...parsed,
    };
    merged.folders = normalizeFolderList(merged.folders || []).filter((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
    return merged;
  } catch {
    return fallback;
  }
}

function saveBackgroundSettings(nextSettings = {}) {
  const current = loadBackgroundSettings();
  const merged = {
    ...current,
    ...nextSettings,
  };
  merged.folders = normalizeFolderList(merged.folders || []).filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
  fs.writeFileSync(
    getBackgroundSettingsPath(),
    JSON.stringify(merged, null, 2),
    "utf8"
  );
  watcherState.settings = merged;
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(merged.consentGiven && merged.enabled && merged.runAtStartup),
      args: ["--background"],
    });
  } catch {}
  return merged;
}

ipcMain.handle("get-backend-url", async () => BACKEND_BASE_URL);

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow || null, {
    title: "Select folder",
    properties: ["openDirectory", "multiSelections"],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("select-image", async () => {
  const result = await dialog.showOpenDialog(mainWindow || null, {
    title: "Select image",
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: ["jpg", "jpeg", "png", "bmp", "gif", "webp"],
      },
    ],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

ipcMain.handle("get-default-index-folders", async () => {
  return loadBackgroundSettings().folders || [];
});

ipcMain.handle("get-background-index-settings", async () => {
  return loadBackgroundSettings();
});

ipcMain.handle("set-background-index-settings", async (_, payload) => {
  return saveBackgroundSettings(payload);
});

ipcMain.handle("merge-background-index-folders", async (_, folders = []) => {
  const existing = loadBackgroundSettings().folders || [];
  const merged = normalizeFolderList([...existing, ...(Array.isArray(folders) ? folders : [])]);
  return saveBackgroundSettings({ folders: merged });
});

ipcMain.handle("open-path", async (_, targetPath) => {
  if (!targetPath) return false;
  try {
    await shell.openPath(String(targetPath));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("open-external", async (_, targetUrl) => {
  if (!targetUrl) return false;
  try {
    await shell.openExternal(String(targetUrl));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("show-item-in-folder", async (_, targetPath) => {
  if (!targetPath) return false;
  try {
    return shell.showItemInFolder(String(targetPath));
  } catch {
    return false;
  }
});

ipcMain.handle("delete-file", async (_, targetPath) => {
  if (!targetPath) return false;
  try {
    fs.unlinkSync(String(targetPath));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("copy-text", async (_, text) => {
  try {
    clipboard.writeText(String(text || ""));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("copy-image", async (_, targetPath) => {
  if (!targetPath) return false;
  try {
    const image = nativeImage.createFromPath(String(targetPath));
    if (image.isEmpty()) return false;
    clipboard.writeImage(image);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("stop-python-app", async () => {
  try {
    if (backendProcess) {
      backendProcess.kill();
      backendProcess = null;
    }
    return true;
  } catch {
    return false;
  }
});

function ensureTray() {
  if (tray) return tray;
  const trayIcon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip("SmartShot");
  tray.on("click", () => showMainWindow());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open SmartShot",
        click: () => showMainWindow(),
      },
      { type: "separator" },
      {
        label: "Quit SmartShot",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  return tray;
}

function isBackgroundLaunch() {
  return process.argv.some((arg) => String(arg || "").toLowerCase() === "--background");
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isBackendHealthy() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(BACKEND_HEALTH_URL, { signal: controller.signal });
    return Boolean(res?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveBackendEntry() {
  // Installed app: the backend ships outside app.asar (resources/backend) so a
  // plain Node process can read it. Dev: use the repo's backend_node folder.
  const candidates = [
    process.env.BACKEND_ENTRY || "",
    app.isPackaged
      ? path.join(process.resourcesPath, "backend", "index.js")
      : path.join(__dirname, "..", "backend_node", "index.js"),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return p;
      }
    } catch {}
  }

  return "";
}

function getPackagedBackendEnv() {
  // Each installation gets its own random JWT secret (never the "secret" fallback),
  // stored in the user's app-data folder so logins survive restarts.
  const crypto = require("crypto");
  const secretPath = path.join(app.getPath("userData"), "jwt-secret.txt");
  let jwtSecret = "";
  try {
    if (fs.existsSync(secretPath)) jwtSecret = fs.readFileSync(secretPath, "utf8").trim();
  } catch {}
  if (!jwtSecret) {
    jwtSecret = crypto.randomBytes(48).toString("hex");
    try { fs.writeFileSync(secretPath, jwtSecret, "utf8"); } catch {}
  }
  const env = {};
  if (!process.env.JWT_SECRET) env.JWT_SECRET = jwtSecret;
  env.SMARTSHOT_INTERNAL_TOKEN = INTERNAL_TOKEN;
  // App data (e.g. optional AI key) lives in the user's AppData folder and survives updates.
  if (!process.env.SMARTSHOT_DATA_DIR) env.SMARTSHOT_DATA_DIR = app.getPath("userData");

  // Google sign-in for everyone who installs the app: the build bundles
  // electron/google-oauth.json (a "Desktop app" OAuth client, git-ignored).
  // Desktop OAuth clients are public clients; the flow is protected by PKCE.
  try {
    const oauthPath = path.join(__dirname, "google-oauth.json");
    if (fs.existsSync(oauthPath)) {
      const cfg = JSON.parse(fs.readFileSync(oauthPath, "utf8"));
      if (cfg.clientId && !process.env.GOOGLE_CLIENT_ID) env.GOOGLE_CLIENT_ID = String(cfg.clientId);
      if (cfg.clientSecret && !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
        env.GOOGLE_OAUTH_CLIENT_SECRET = String(cfg.clientSecret);
      }
    }
  } catch (err) {
    writeMainLog("google-oauth.json could not be read", err && err.message);
  }
  if (embeddedMongoUri && !process.env.MONGO_URI) env.MONGO_URI = embeddedMongoUri;
  return env;
}

function spawnBackendProcess(entryPath = "") {
  if (!entryPath) return false;
  try { writeMainLog('spawnBackendProcess', entryPath); } catch {}
  // Installed app always runs the backend on Electron's bundled Node, so users
  // don't need Node.js installed and native modules match one runtime.
  const nodeBinary = app.isPackaged ? "" : resolveNodeBinary();
  const useElectronNode = !nodeBinary;
  const runtime = nodeBinary || process.execPath;
  const logPath = getBackendLogPath();
  let logStream = null;
  try {
    logStream = fs.createWriteStream(logPath, { flags: "a" });
    logStream.write(`\n[${new Date().toISOString()}] Spawning backend using ${runtime}\n`);
  } catch {}

  const child = spawn(runtime, [entryPath], {
    cwd: path.dirname(entryPath),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(app.isPackaged ? getPackagedBackendEnv() : {}),
      ...(useElectronNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
  });

  backendProcess = child;
  backendSpawnedByApp = true;

  child.on("exit", () => {
    backendProcess = null;
    backendSpawnedByApp = false;
    try {
      logStream?.write(`[${new Date().toISOString()}] Backend exited\n`);
      logStream?.end();
      try { writeMainLog('backend exited'); } catch {}
    } catch {}
  });

  child.on("error", (err) => {
    console.error("Backend spawn error:", err?.message || err);
    try {
      logStream?.write(
        `[${new Date().toISOString()}] Backend spawn error: ${err?.message || err}\n`
      );
    } catch {}
  });

  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      try {
        if (logStream && !logStream.writableEnded) logStream.write(chunk);
      } catch {}
    });
  }

  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      try {
        if (logStream && !logStream.writableEnded) logStream.write(chunk);
        try { writeMainLog('backend stderr', String(chunk || '').slice(0,200)); } catch {}
      } catch {}
    });
  }

  return true;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveRendererIndex() {
  const appRoot = path.resolve(__dirname, "..");
  const candidates = [
    path.join(appRoot, "client", "build", "index.html"),
    path.join(process.cwd(), "client", "build", "index.html"),
    path.join(app.getAppPath(), "client", "build", "index.html"),
    path.join(process.resourcesPath || "", "app", "client", "build", "index.html"),
  ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {}
  }

  return "";
}

function loadFallbackPage(title, bodyLines = []) {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; font-family: Segoe UI, Arial, sans-serif; color: #202124; background: #f7f7f5; }
      main { max-width: 760px; margin: 64px auto; padding: 0 24px; }
      h1 { font-size: 24px; margin: 0 0 16px; }
      p { line-height: 1.5; overflow-wrap: anywhere; }
      code { background: #ececea; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      ${bodyLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n      ")}
    </main>
  </body>
</html>`;

  const fallbackPath = path.join(app.getPath("userData"), "renderer-error.html");
  try {
    fs.writeFileSync(fallbackPath, html, "utf8");
    return mainWindow.loadFile(fallbackPath);
  } catch {
    return mainWindow.loadURL("about:blank");
  }
}

function resolveEmbeddedMongoBinary() {
  const candidates = [
    process.env.SMARTSHOT_MONGOD_PATH || "",
    app.isPackaged
      ? path.join(process.resourcesPath, "mongodb", "smartshot-mongod.exe")
      : path.join(__dirname, "..", "vendor", "mongodb", "smartshot-mongod.exe"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return "";
}

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 800) {
  const net = require("net");
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok) => {
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function readLogTail(filePath, maxBytes = 4000) {
  try {
    const st = fs.statSync(filePath);
    const fd = fs.openSync(filePath, "r");
    const len = Math.min(maxBytes, st.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

function mongoArgs(dbPath, logPath) {
  return [
    "--dbpath", dbPath,
    "--port", String(EMBEDDED_MONGO_PORT),
    "--bind_ip", "127.0.0.1",
    "--logpath", logPath,
    "--logappend",
    "--wiredTigerCacheSizeGB", "0.25",
  ];
}

// Watchdog: restart the database if it stops unexpectedly while the app runs.
let mongoRestarts = 0;
const MAX_MONGO_RESTARTS = 3;

// Starts mongod once and waits until it accepts connections (or exits).
async function tryStartMongo(binary, dbPath, logPath) {
  const child = spawn(binary, mongoArgs(dbPath, logPath), { windowsHide: true, stdio: "ignore" });
  mongoProcess = child;
  let exitCode = null;
  child.on("exit", (code) => {
    exitCode = code;
    writeMainLog("embedded mongod exited", { code });
    if (mongoProcess === child) mongoProcess = null;
  });
  child.on("error", (err) => {
    exitCode = -1;
    writeMainLog("embedded mongod spawn error", err && err.message);
  });

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await isPortOpen(EMBEDDED_MONGO_PORT)) {
      child.once("exit", () => {
        if (isQuitting || mongoRestarts >= MAX_MONGO_RESTARTS) return;
        mongoRestarts += 1;
        writeMainLog("embedded mongod stopped unexpectedly; restarting", { attempt: mongoRestarts });
        setTimeout(() => {
          startEmbeddedMongo().catch(() => {});
        }, 1000);
      });
      return true;
    }
    if (exitCode !== null) return false;
    await sleep(400);
  }
  return false;
}

function killStrayMongo() {
  // Only our own renamed binary, never a MongoDB the user runs themselves.
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve();
    execFile("taskkill", ["/F", "/IM", "smartshot-mongod.exe", "/T"], { windowsHide: true }, () => resolve());
  });
}

function runMongoRepair(binary, dbPath, logPath) {
  return new Promise((resolve) => {
    writeMainLog("running mongod --repair");
    const child = spawn(binary, ["--dbpath", dbPath, "--logpath", logPath, "--logappend", "--repair"], {
      windowsHide: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve(false);
    }, 180000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      writeMainLog("mongod --repair finished", { code });
      resolve(code === 0);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function startEmbeddedMongo() {
  const uri = `mongodb://127.0.0.1:${EMBEDDED_MONGO_PORT}/smart_screenshot_db`;
  // Already running (e.g. left over from a previous session)? Reuse it.
  if (await isPortOpen(EMBEDDED_MONGO_PORT)) return uri;

  const binary = resolveEmbeddedMongoBinary();
  if (!binary) {
    writeMainLog("embedded mongod not found; backend will use MONGO_URI from its .env if any");
    return "";
  }

  const dbPath = path.join(app.getPath("userData"), "mongo-data");
  const logPath = path.join(app.getPath("userData"), "mongod.log");
  const lockPath = path.join(dbPath, "mongod.lock");
  try { fs.mkdirSync(dbPath, { recursive: true }); } catch {}

  writeMainLog("starting embedded mongod", binary, dbPath);
  if (await tryStartMongo(binary, dbPath, logPath)) return uri;

  // Recovery 1: a leftover database process or stale lock from a crash / force-quit.
  writeMainLog("mongod failed to start; recovering. log tail:", readLogTail(logPath, 1500));
  await killStrayMongo();
  await sleep(1500);
  try { fs.rmSync(lockPath, { force: true }); } catch {}
  if (await tryStartMongo(binary, dbPath, logPath)) return uri;

  // Recovery 2: let MongoDB repair its data files, then try once more.
  await killStrayMongo();
  await sleep(1000);
  try { fs.rmSync(lockPath, { force: true }); } catch {}
  if ((await runMongoRepair(binary, dbPath, logPath)) && (await tryStartMongo(binary, dbPath, logPath))) {
    return uri;
  }

  writeMainLog("embedded mongod did not become ready; see", logPath);
  return "";
}

// Ask the backend to shut MongoDB down cleanly, then wait for it to exit.
async function shutdownEmbeddedMongoGracefully(timeoutMs = 6000) {
  if (!mongoProcess) return;
  const proc = mongoProcess;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    await fetch(`${BACKEND_BASE_URL.replace(/\/+$/, "")}/internal/shutdown-db`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL_TOKEN },
      body: "{}",
      signal: controller.signal,
    }).catch(() => {});
    clearTimeout(t);
  } catch {}
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && proc.exitCode === null && mongoProcess === proc) {
    await sleep(200);
  }
}

function stopEmbeddedMongo() {
  if (!mongoProcess) return;
  try { mongoProcess.kill(); } catch {}
  mongoProcess = null;
}

async function ensureBackendRunning() {
  if (await isBackendHealthy()) return true;

  if (app.isPackaged && !process.env.MONGO_URI) {
    embeddedMongoUri = await startEmbeddedMongo();
  }

  const entryPath = resolveBackendEntry();
  if (!entryPath) {
    console.error("Backend entry not found. Expected backend_node/index.js in app bundle.");
    return false;
  }

  if (!spawnBackendProcess(entryPath)) return false;

  const deadline = Date.now() + BACKEND_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isBackendHealthy()) return true;
    await sleep(450);
  }

  return false;
}

async function backendPost(route, body = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(`${BACKEND_BASE_URL}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

function stopBackgroundWatchers() {
  for (const watcher of watcherState.watchers.values()) {
    try {
      watcher.close();
    } catch {}
  }
  watcherState.watchers.clear();
  for (const timer of watcherState.timers.values()) {
    clearTimeout(timer);
  }
  watcherState.timers.clear();
  watcherState.retryCounts.clear();
  watcherState.queue.clear();
  watcherState.running = false;
}

async function flushWatcherQueue() {
  if (watcherState.processing) return;
  watcherState.processing = true;
  const settings = watcherState.settings || loadBackgroundSettings();

  try {
    while (watcherState.queue.size) {
      const [nextPath] = watcherState.queue;
      watcherState.queue.delete(nextPath);
      if (!pathInFolders(nextPath, settings.folders)) continue;
      try {
        const exists = fs.existsSync(nextPath);
        let syncOk = true;
        if (exists && fs.statSync(nextPath).isFile()) {
          const resp = await backendPost("/api/search/sync-file", {
            path: nextPath,
            allowedFolders: settings.strictPrivacy ? settings.folders : [],
          });
          syncOk = Boolean(resp?.ok);
        } else if (!exists) {
          const resp = await backendPost("/api/search/sync-delete", {
            path: nextPath,
            allowedFolders: settings.strictPrivacy ? settings.folders : [],
          });
          syncOk = Boolean(resp?.ok);
        } else {
          syncOk = true;
        }
        if (!syncOk) {
          const attempt = Number(watcherState.retryCounts.get(nextPath) || 0) + 1;
          watcherState.retryCounts.set(nextPath, attempt);
          if (attempt <= 5) {
            setTimeout(() => {
              enqueuePathSync(nextPath);
            }, Math.min(15000, attempt * 2500));
          } else {
            watcherState.retryCounts.delete(nextPath);
          }
        } else {
          watcherState.retryCounts.delete(nextPath);
        }
      } catch {}
    }
  } finally {
    watcherState.processing = false;
  }
}

function enqueuePathSync(targetPath = "") {
  const p = String(targetPath || "").trim();
  if (!p) return;
  watcherState.queue.add(p);
  void flushWatcherQueue();
}

function schedulePathSync(targetPath = "") {
  const p = String(targetPath || "").trim();
  if (!p) return;
  const old = watcherState.timers.get(p);
  if (old) clearTimeout(old);
  const timer = setTimeout(() => {
    watcherState.timers.delete(p);
    enqueuePathSync(p);
  }, WATCHER_DEBOUNCE_MS);
  watcherState.timers.set(p, timer);
}

async function startBackgroundWatchers(settingsInput = null) {
  const settings = settingsInput || watcherState.settings || loadBackgroundSettings();
  watcherState.settings = settings;
  stopBackgroundWatchers();

  if (!settings?.enabled || !settings?.consentGiven) {
    return { running: false, watched: 0 };
  }

  const useSpecificFolders = Boolean(settings?.useSpecificFolders);
  const watchBase = useSpecificFolders
    ? normalizeFolderList(settings.folders || [])
    : getSystemWideWatchFolders();
  const folders = watchBase.filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });

  if (!folders.length) return { running: false, watched: 0 };

  folders.forEach((folder) => {
    try {
      const watcher = fs.watch(
        folder,
        { recursive: true },
        (_, filename) => {
          const rel = String(filename || "").trim();
          if (!rel) return;
          const full = path.join(folder, rel);
          schedulePathSync(full);
        }
      );
      watcherState.watchers.set(folder, watcher);
    } catch (err) {
      console.warn("Background watch failed for:", folder, err?.message || err);
    }
  });

  watcherState.running = watcherState.watchers.size > 0;
  return { running: watcherState.running, watched: watcherState.watchers.size };
}

function createWindow() {
  if (!fs.existsSync(iconPath)) {
    console.warn(`Icon file not found at ${iconPath}`);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    icon: iconPath,
    title: "Smart Screenshot Search Engine",
    backgroundColor: "#f6efe6",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const buildIndexPath = resolveRendererIndex();

  console.log(`[Electron] Build path: ${buildIndexPath || "(not found)"}`);

  if (buildIndexPath) {
    console.log("[Electron] Loading build from:", buildIndexPath);
    mainWindow.loadFile(buildIndexPath).catch(err => {
      console.error("[Electron] Failed to load file:", err);
      loadFallbackPage("Failed to Load UI", [
        `Error: ${err.message}`,
        `Path: ${buildIndexPath}`,
      ]);
    });
    watchRenderer(mainWindow);
  } else {
    const expectedPath = path.join(
      path.resolve(__dirname, ".."),
      "client",
      "build",
      "index.html"
    );
    console.error("[Electron] Build file not found:", expectedPath);
    loadFallbackPage("UI Build Not Found", [
      `Expected path: ${expectedPath}`,
      "Run this from the project root: npm.cmd run client-build",
    ]);
  }
  
  // Ensure window is visible
  mainWindow.show();

  const thisWindow = mainWindow;
  thisWindow.on("closed", () => {
    if (mainWindow === thisWindow) mainWindow = null;
  });

  mainWindow.on("close", (event) => {
    const settings = watcherState.settings || loadBackgroundSettings();
    const shouldKeepTray = Boolean(
      settings?.consentGiven && settings?.enabled && settings?.keepRunningInTray
    );
    if (!isQuitting && shouldKeepTray) {
      event.preventDefault();
      mainWindow.hide();
      ensureTray();
    }
  });
}

// If the page crashes or freezes, reload it instead of leaving a blank window.
function watchRenderer(win) {
  let unresponsiveTimer = null;
  win.webContents.on("render-process-gone", (_e, details) => {
    try { writeMainLog("renderer gone; reloading", details && details.reason); } catch {}
    if (isQuitting || win.isDestroyed()) return;
    setTimeout(() => {
      if (!win.isDestroyed()) win.reload();
    }, 800);
  });
  win.on("unresponsive", () => {
    if (unresponsiveTimer) return;
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      if (isQuitting || win.isDestroyed()) return;
      try { writeMainLog("window unresponsive for 15s; reloading"); } catch {}
      try { win.webContents.forcefullyCrashRenderer(); } catch {}
      setTimeout(() => {
        if (!win.isDestroyed()) win.reload();
      }, 800);
    }, 15000);
  });
  win.on("responsive", () => {
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = null;
    }
  });
}

// After the PC wakes from sleep, make sure the database and search service
// are still running, and quietly restart them if not.
let resumeCheckRunning = false;
async function checkServicesAfterResume() {
  if (resumeCheckRunning || isQuitting) return;
  resumeCheckRunning = true;
  try {
    await sleep(4000);
    writeMainLog("system resumed; checking services");
    mongoRestarts = 0;
    if (app.isPackaged && !process.env.MONGO_URI && !(await isPortOpen(EMBEDDED_MONGO_PORT))) {
      writeMainLog("database not running after resume; restarting");
      embeddedMongoUri = await startEmbeddedMongo();
    }
    if (!(await isBackendHealthy())) {
      writeMainLog("search service not answering after resume; restarting");
      killBackendProcess();
      await ensureBackendRunning();
    }
  } catch (err) {
    try { writeMainLog("resume check failed", err && err.message); } catch {}
  } finally {
    resumeCheckRunning = false;
  }
}

app.whenReady().then(async () => {
  // A second launch only checks on the running copy, then exits (see top of file).
  if (!gotLock) return;
  startHeartbeat();
  try {
    powerMonitor.on("resume", () => { void checkServicesAfterResume(); });
    powerMonitor.on("unlock-screen", () => { void checkServicesAfterResume(); });
  } catch {}
  app.setAppUserModelId(appUserModelId);
  watcherState.settings = loadBackgroundSettings();
  try { writeMainLog('app.whenReady - starting with settings', watcherState.settings); } catch {}

  const shouldRunHeadless =
    watcherState.settings?.consentGiven &&
    watcherState.settings?.enabled &&
    watcherState.settings?.keepRunningInTray;
  const launchInBackground = isBackgroundLaunch() && shouldRunHeadless;

  // Show the window right away: the UI shows "Starting…" until the backend answers.
  if (!launchInBackground) {
    createWindow();
  } else {
    // Running in the background: show a tray icon so the app can be opened or quit.
    ensureTray();
  }

  const backendOk = await ensureBackendRunning();
  try { writeMainLog('ensureBackendRunning result', { ok: backendOk }); } catch {}
  if (!backendOk && !launchInBackground) {
    dialog.showErrorBox(
      "SmartShot couldn't start",
      `The app's search service didn't start. Close SmartShot and open it again.\n\nIf this keeps happening, restart your computer. Details are in:\n${getBackendLogPath()}`
    );
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(
        watcherState.settings?.consentGiven &&
          watcherState.settings?.enabled &&
          watcherState.settings?.runAtStartup
      ),
      args: ["--background"],
    });
  } catch {}
  void startBackgroundWatchers(watcherState.settings);
});

let quitCleanupDone = false;

function killBackendProcess() {
  if (backendSpawnedByApp && backendProcess) {
    try {
      backendProcess.kill();
    } catch {}
    backendProcess = null;
    backendSpawnedByApp = false;
  }
}

app.on("before-quit", (event) => {
  isQuitting = true;
  stopBackgroundWatchers();
  if (quitCleanupDone || !mongoProcess) {
    killBackendProcess();
    stopEmbeddedMongo();
    return;
  }
  // Close the database cleanly first so it never needs recovery on next start.
  event.preventDefault();
  // Safety net: never leave a half-closed copy running in the background.
  setTimeout(() => {
    try { writeMainLog("quit took too long; forcing exit"); } catch {}
    try { stopEmbeddedMongo(); } catch {}
    app.exit(0);
  }, 15000).unref?.();
  shutdownEmbeddedMongoGracefully()
    .catch(() => {})
    .finally(() => {
      quitCleanupDone = true;
      killBackendProcess();
      stopEmbeddedMongo();
      app.quit();
    });
});

app.on("activate", () => {
  if (gotLock) showMainWindow();
});

app.on("will-quit", () => {
  // Clean exit: no heartbeat left behind for the next launch to inspect.
  try {
    const hb = readHeartbeat();
    if (hb && hb.pid === process.pid) fs.unlinkSync(heartbeatFile());
  } catch {}
});
