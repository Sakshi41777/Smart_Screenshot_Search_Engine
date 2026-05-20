<<<<<<< HEAD
const { contextBridge, ipcRenderer } = require("electron");

// Backend URL getter (synchronous fallback)
async function getBackendUrlSafe() {
  try {
    const url = await ipcRenderer.invoke("get-backend-url");
    return url || "http://127.0.0.1:5001";
  } catch {
    return "http://127.0.0.1:5001";
  }
}

// Expose IPC methods for main process communication
contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  selectImage: () => ipcRenderer.invoke("select-image"),
  getDefaultIndexFolders: () => ipcRenderer.invoke("get-default-index-folders"),
  getBackgroundIndexSettings: () =>
    ipcRenderer.invoke("get-background-index-settings"),
  setBackgroundIndexSettings: (payload) =>
    ipcRenderer.invoke("set-background-index-settings", payload),
  mergeBackgroundIndexFolders: (folders) =>
    ipcRenderer.invoke("merge-background-index-folders", folders),
  openPath: (targetPath) => ipcRenderer.invoke("open-path", targetPath),
  openExternal: (targetUrl) => ipcRenderer.invoke("open-external", targetUrl),
  showItemInFolder: (targetPath) =>
    ipcRenderer.invoke("show-item-in-folder", targetPath),
  deleteFile: (targetPath) => ipcRenderer.invoke("delete-file", targetPath),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  copyImage: (targetPath) => ipcRenderer.invoke("copy-image", targetPath),
  getBackendUrl: () => getBackendUrlSafe(),
});

// Also expose backend URL synchronously via contextBridge
contextBridge.exposeInMainWorld("BACKEND_BASE_URL", "http://127.0.0.1:5001");

console.log("[Preload] Electron environment ready");
=======
// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

console.log('[preload] loaded');

contextBridge.exposeInMainWorld('electronAPI', {
  openPythonApp: (opts = {}) => ipcRenderer.invoke('openPythonApp', opts),
  stopPythonApp: () => ipcRenderer.invoke('stopPythonApp'),
  isPythonRunning: () => ipcRenderer.invoke('isPythonRunning'),
  onPythonLog: (cb) => {
    const listener = (e, payload) => cb(payload);
    ipcRenderer.on('python-log', listener);
    return () => ipcRenderer.removeListener('python-log', listener);
  }
});
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
