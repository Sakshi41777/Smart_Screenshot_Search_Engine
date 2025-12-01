// client/src/ClearSessionButton.jsx
import React, { useState } from "react";

/**
 * Props:
 *  - onLogout: optional function() to call after clearing session (e.g. setUser(null))
 *  - label: optional button label
 */
export default function ClearSessionButton({ onLogout, label = "Clear Session" }) {
  const [loading, setLoading] = useState(false);

  async function handleClear() {
    if (loading) return;
    const ok = window.confirm("Clear local session and stop any running Python app? This will log you out.");
    if (!ok) return;

    setLoading(true);

    try {
      // If running inside Electron, try to tell main process to stop python app
      if (window?.electronAPI?.stopPythonApp) {
        try {
          await window.electronAPI.stopPythonApp();
        } catch (e) {
          // ignore errors from stopping
          console.warn("stopPythonApp error:", e);
        }
      }

      // clear local storage keys (clear everything to be safe)
      try {
        localStorage.clear();
      } catch (e) {
        console.warn("localStorage.clear failed:", e);
      }

      // call optional callback so React can immediately update state
      if (typeof onLogout === "function") {
        try {
          onLogout();
        } catch (e) {
          console.warn("onLogout callback error:", e);
        }
      }

      // reload to ensure UI resets fully
      // small delay so any IPC calls finish
      setTimeout(() => {
        try {
          // In Electron use location.reload()
          window.location.reload();
        } catch (e) {
          // fallback
          console.warn("reload failed:", e);
        }
      }, 200);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClear}
      className="btn ghost clear-session-btn"
      title="Clear saved session (logout + reset app)"
      disabled={loading}
      style={{ minWidth: 120 }}
    >
      {loading ? "Clearing..." : label}
    </button>
  );
}
