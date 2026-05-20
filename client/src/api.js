// client/src/api.js
import axios from "axios";

// Desktop backend fallback used before Electron preload finishes.
const DEFAULT_BACKEND_URL = "http://127.0.0.1:5001";

// Log initial state for debugging
if (typeof window !== "undefined") {
  console.log("[API] window.BACKEND_BASE_URL:", window.BACKEND_BASE_URL);
  console.log("[API] window.electronAPI:", !!window.electronAPI);
}

// Get the backend URL - prefer window.BACKEND_BASE_URL exposed via contextBridge (preload)
function getBackendUrl() {
  if (typeof window !== "undefined" && window.BACKEND_BASE_URL) {
    console.log("[API] Using window.BACKEND_BASE_URL:", window.BACKEND_BASE_URL);
    return window.BACKEND_BASE_URL;
  }
  console.log("[API] Using DEFAULT_BACKEND_URL:", DEFAULT_BACKEND_URL);
  return DEFAULT_BACKEND_URL;
}

// Create axios instance immediately with the correct backend URL
const baseURL = getBackendUrl();
console.log("[API] Creating axios with baseURL:", baseURL);

const instance = axios.create({
  baseURL: baseURL,
  timeout: 20000,
});

