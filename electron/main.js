// electron/main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let pythonProcess = null;

// Detect dev mode
const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === '1';

// default python args
const pyArgs = [];

// Start Python (dev uses venv Python if present)
function startPythonApp(args = pyArgs) {
  if (pythonProcess) {
    console.log('[main] python already running');
    return;
  }

  if (isDev) {
    // in dev point to your venv python to ensure same env
    const pyCmd = process.platform === 'win32'
      ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe')
      : 'python3';
    const pyScript = path.join(__dirname, '..', 'app', 'main.py');

    console.log('[main] spawning python (dev):', pyCmd, pyScript, ['--from-electron', ...args]);
    pythonProcess = spawn(pyCmd, [pyScript, '--from-electron', ...args], { stdio: 'pipe' });

    pythonProcess.stdout.on('data', (d) => {
      const txt = d.toString();
      console.log('[python stdout]', txt.trim());
      if (mainWindow) mainWindow.webContents.send('python-log', { type: 'stdout', message: txt });
    });
    pythonProcess.stderr.on('data', (d) => {
      const txt = d.toString();
      console.error('[python stderr]', txt.trim());
      if (mainWindow) mainWindow.webContents.send('python-log', { type: 'stderr', message: txt });
    });

    pythonProcess.on('exit', (code) => {
      console.log('[main] python exited', code);
      pythonProcess = null;
      if (mainWindow) mainWindow.webContents.send('python-log', { type: 'exit', message: code });
    });

    pythonProcess.on('error', (err) => {
      console.error('[main] python spawn error', err);
      pythonProcess = null;
    });

  } else {
    // production: expect bundled exe in resources/python/
    const exePath = path.join(process.resourcesPath, 'python', 'smartshot.exe');
    if (!fs.existsSync(exePath)) {
      console.error('[main] packaged python exe not found at', exePath);
      return;
    }

    console.log('[main] spawning python (prod):', exePath, ['--from-electron', ...args]);
    pythonProcess = spawn(exePath, ['--from-electron', ...args], { detached: true, stdio: 'ignore' });
    pythonProcess.unref();
  }
}

function stopPythonApp() {
  if (!pythonProcess) return;
  try {
    pythonProcess.kill();
  } catch (err) {
    console.warn('[main] failed to kill python', err);
  } finally {
    pythonProcess = null;
  }
}

// IPC handlers exposed to renderer via preload
ipcMain.handle('openPythonApp', async (event, { args = [] } = {}) => {
  startPythonApp(args);
  return { ok: true };
});

ipcMain.handle('stopPythonApp', async () => {
  stopPythonApp();
  return { ok: true };
});

ipcMain.handle('isPythonRunning', async () => {
  return { running: !!pythonProcess };
});

// Create the browser window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  console.log('[main] creating window, isDev=', isDev, 'preload=', path.join(__dirname, 'preload.js'));

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Gracefully close python when app quits
app.on('before-quit', () => {
  stopPythonApp();
});

// Quit when all windows are closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
