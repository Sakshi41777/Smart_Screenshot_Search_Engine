const { app, BrowserWindow, dialog, ipcMain, shell, clipboard, nativeImage, Tray, Menu } = require("electron");
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
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
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

    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}


let mainWindow;
let tray = null;
let isQuitting = false;
const iconPath = path.join(__dirname, "resources", "icon.ico");
const appUserModelId = "com.smartshot.desktop";
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || "http://127.0.0.1:5001";
const isDev = process.env.NODE_ENV === "development";
const BACKEND_HEALTH_URL = `${BACKEND_BASE_URL.replace(/\/+$/, "")}/health`;
const BACKEND_STARTUP_TIMEOUT_MS = 30000;
const WATCHER_DEBOUNCE_MS = 900;
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
  tray.setToolTip("Smart Screenshot Search Engine");
  tray.on("click", () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open",
        click: () => {
          if (!mainWindow) {
            createWindow();
            return;
          }
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: "Quit",
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
  const candidates = [
    process.env.BACKEND_ENTRY || "",
    path.join(app.getAppPath(), "backend_node", "index.js"),
    path.join(process.resourcesPath, "app.asar.unpacked", "backend_node", "index.js"),
    path.join(process.resourcesPath, "app", "backend_node", "index.js"),
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

function spawnBackendProcess(entryPath = "") {
  if (!entryPath) return false;
  try { writeMainLog('spawnBackendProcess', entryPath); } catch {}
  const nodeBinary = resolveNodeBinary();
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
        logStream?.write(chunk);
      } catch {}
    });
  }

  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      try {
        logStream?.write(chunk);
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

async function ensureBackendRunning() {
  if (await isBackendHealthy()) return true;

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
    icon: iconPath,
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
    // Show DevTools in development for debugging
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.on('did-fail-load', () => {
        console.error("[Electron] WebContents failed to load");
      });
      mainWindow.webContents.on('crashed', () => {
        console.error("[Electron] WebContents crashed");
      });
    }
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

app.whenReady().then(async () => {
  app.setAppUserModelId(appUserModelId);
  watcherState.settings = loadBackgroundSettings();
  try { writeMainLog('app.whenReady - starting with settings', watcherState.settings); } catch {}
  const backendOk = await ensureBackendRunning();
  try { writeMainLog('ensureBackendRunning result', { ok: backendOk }); } catch {}
  if (!backendOk && !isBackgroundLaunch()) {
    dialog.showErrorBox(
      "Backend Unavailable",
      `Local backend could not be started on http://127.0.0.1:5001.\nCheck ${getBackendLogPath()} for details, then restart the app.`
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
  const shouldRunHeadless =
    watcherState.settings?.consentGiven &&
    watcherState.settings?.enabled &&
    watcherState.settings?.keepRunningInTray;
  const launchInBackground = isBackgroundLaunch() && shouldRunHeadless;

  if (!launchInBackground) {
    createWindow();
  }
  void startBackgroundWatchers(watcherState.settings);
});

app.on("before-quit", () => {
  isQuitting = true;
  stopBackgroundWatchers();
  if (backendSpawnedByApp && backendProcess) {
    try {
      backendProcess.kill();
    } catch {}
    backendProcess = null;
    backendSpawnedByApp = false;
  }
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
  else mainWindow.show();
});
