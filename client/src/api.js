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

/* ===========================
   REQUEST INTERCEPTOR
=========================== */
instance.interceptors.request.use(
  (cfg) => {
    const token = getAuthToken();
    if (token) {
      cfg.headers = cfg.headers || {};
      cfg.headers.Authorization = `Bearer ${token}`;
    }

    const isSearchRequest =
      cfg.method?.toLowerCase() === "post" &&
      cfg.url?.endsWith("/api/search") &&
      !(cfg.data instanceof FormData);

    if (isSearchRequest) {
      cfg.data =
        cfg.data && typeof cfg.data === "object" ? { ...cfg.data } : {};
      if (cfg.data.minConfidence == null) {
        cfg.data.minConfidence = 0.75;
      }
    }

    console.debug(
      "[API request]",
      cfg.method?.toUpperCase(),
      (cfg.baseURL || "") + (cfg.url || "")
    );
    return cfg;
  },
  (err) => Promise.reject(err)
);

/* ===========================
   RESPONSE INTERCEPTOR
=========================== */
instance.interceptors.response.use(
  (res) => {
    const isSearchResponse =
      res?.config?.method?.toLowerCase() === "post" &&
      res?.config?.url?.endsWith("/api/search");

    if (isSearchResponse && res.data) {
      res.data = sanitizeSearchResponsePayload(res.data);
    }

    console.debug("[API response]", res.status, res.config?.url);
    return res;
  },
  (err) => {
    const isTimeout = err?.code === "ECONNABORTED";
    const isNetwork = !err?.response;

    if (isTimeout || isNetwork) {
      const attemptedUrl = instance.defaults.baseURL || DEFAULT_BACKEND_URL;
      err.message =
        `Backend service is not reachable at ${attemptedUrl}. ` +
        `Make sure desktop backend is running on http://127.0.0.1:5001.`;
      console.error("[API] Network error details:", {
        baseURL: attemptedUrl,
        timeout: isTimeout,
        network: isNetwork,
        error: err?.message,
        code: err?.code,
      });
    }

    console.error(
      "[API response error]",
      err?.response?.status || err?.message
    );

    if (err?.response?.status === 401) {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("APP_USER");
      localStorage.removeItem("auth_user");
      redirectToSignIn();
    }

    return Promise.reject(err);
  }
);

// Export the axios instance directly
export default instance;

// Also export getApiInstance for compatibility
export async function getApiInstance() {
  return instance;
}

/* =========================
   AUTH TOKEN
========================= */
function getAuthToken() {
  const token =
    localStorage.getItem("APP_TOKEN") ||
    localStorage.getItem("auth_token") ||
    null;
  if (!token || token === "null" || token === "undefined") return null;
  return token;
}

function redirectToSignIn() {
  if (window.location.protocol === "file:") {
    window.location.hash = "#/signin";
    return;
  }
  window.location.assign("/signin");
}

/* =========================
   SANITIZE SEARCH RESPONSE
========================= */
function sanitizeSearchResponsePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const sanitizeItem = (it) => ({
    name: it?.name || "",
    path: it?.path || "",
    type: it?.type || "image",
    extractText: it?.extractText || it?.extractedText || "",
    sizeKB: typeof it?.sizeKB === "number" ? it.sizeKB : 0,
    createdAt: it?.createdAt || null,
    thumbnailUrl: it?.thumbnailUrl || null,
    tags: Array.isArray(it?.tags) ? it.tags.slice(0, 12) : [],
  });

  return {
    ...payload,
    files: Array.isArray(payload.files)
      ? payload.files.map(sanitizeItem)
      : [],
    top5: Array.isArray(payload.top5)
      ? payload.top5.map(sanitizeItem)
      : [],
  };
}

// Interceptors are attached to the instance immediately upon module load.

/* =========================
   SEARCH HELPER
========================= */
export async function search(payload = {}) {
  const inst = await getApiInstance();
  const body = payload && typeof payload === "object" ? { ...payload } : {};
  if (body.minConfidence == null) body.minConfidence = 0.75;
  return inst.post("/api/search", body);
}
