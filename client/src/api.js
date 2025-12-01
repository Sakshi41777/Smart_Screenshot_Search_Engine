// client/src/api.js
import axios from "axios";

const API_BASE = process.env.REACT_APP_API_BASE || "http://127.0.0.1:5000";

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
});

// --- DEBUG: log requests/responses to renderer console ---
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("auth_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  // ensure we always use absolute URL (helpful in Electron)
  if (cfg.url && cfg.url.startsWith('/')) {
    cfg.url = `${API_BASE}${cfg.url}`;
  }
  console.debug('[API request]', cfg.method, cfg.baseURL ? cfg.baseURL + cfg.url : cfg.url, cfg);
  return cfg;
}, (err) => {
  console.error('[API request error]', err);
  return Promise.reject(err);
});

api.interceptors.response.use((r) => {
  console.debug('[API response]', r.status, r.config && (r.config.baseURL ? r.config.baseURL + r.config.url : r.config.url), r);
  return r;
}, (err) => {
  console.error('[API response error]', err && (err.response ? err.response.status : err.message), err);
  if (err?.response?.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    // reload to show sign-in
    window.location.reload();
  }
  return Promise.reject(err);
});

export default api;
