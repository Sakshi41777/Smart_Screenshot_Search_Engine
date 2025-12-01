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
