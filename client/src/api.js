// client/src/api.js
import axios from "axios";

// Desktop backend fallback used before Electron preload finishes.
const DEFAULT_BACKEND_URL = "http://127.0.0.1:5001";

function getBackendUrl() {
  if (typeof window !== "undefined" && window.BACKEND_BASE_URL) {
    return window.BACKEND_BASE_URL;
  }
  return DEFAULT_BACKEND_URL;
}

const instance = axios.create({
  baseURL: getBackendUrl(),
  timeout: 20000,
});

// Send the signed-in user's token with every request. Without this, every
// account route (profile, saved items, history) answered 401 "not signed in".
instance.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem("APP_TOKEN");
    if (token && !config.headers?.Authorization) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {}
  return config;
});

// A token the backend rejects (expired, or from an older install) signs the
// user out once, instead of every page failing quietly.
instance.interceptors.response.use(
  (response) => response,
  (error) => {
    try {
      const status = error?.response?.status;
      const url = String(error?.config?.url || "");
      const hadToken = Boolean(error?.config?.headers?.Authorization);
      const isAuthRoute = url.includes("/api/auth/");
      if (status === 401 && hadToken && !isAuthRoute) {
        window.dispatchEvent(new CustomEvent("app:session-expired"));
      }
    } catch {}
    return Promise.reject(error);
  }
);

export default instance;
