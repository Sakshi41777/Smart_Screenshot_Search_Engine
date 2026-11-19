// client/src/App.js
// No sign-in: the app opens straight to Search with a local profile stored on
// this computer, so Saved and History always work. Users can optionally set a
// display name in Settings to personalise the app (see displayName.js).
import React, { useCallback, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import api from "./api";
import SearchPage from "./pages/SearchPage";
import Profile from "./pages/Profile";
import Saved from "./pages/Saved";
import History from "./pages/History";
import Knowledge from "./pages/Knowledge";

/* ---------- helpers ---------- */
function readSavedUser() {
  try {
    const u = localStorage.getItem("APP_USER");
    if (u) return JSON.parse(u);
  } catch {}
  return null;
}

function readSavedToken() {
  try {
    return localStorage.getItem("APP_TOKEN");
  } catch {
    return null;
  }
}

function persistAuth({ token, user }) {
  try {
    localStorage.removeItem("APP_TOKEN");
    localStorage.removeItem("APP_USER");
    if (token) localStorage.setItem("APP_TOKEN", token);
    if (user) localStorage.setItem("APP_USER", JSON.stringify(user));
  } catch {}
}

function clearAuth() {
  try {
    localStorage.removeItem("APP_TOKEN");
    localStorage.removeItem("APP_USER");
  } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- App ---------- */
export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [startError, setStartError] = useState("");
  const [slowStart, setSlowStart] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlowStart(true), 6000);
    return () => clearTimeout(t);
  }, []);

  // Get (or create) the built-in local profile and use it.
  const openLocalProfile = useCallback(async () => {
    let lastErr = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const res = await api.post("/api/auth/local");
        const token = res?.data?.token;
        const localUser = res?.data?.user ? { ...res.data.user, local: true } : null;
        if (token && localUser) {
          persistAuth({ token, user: localUser });
          setUser(localUser);
          setStartError("");
          return true;
        }
      } catch (err) {
        lastErr = err;
      }
      await sleep(1000); // database may still be starting or repairing
    }
    console.error("Local profile unavailable", lastErr);
    setStartError("The app couldn't start its local database. Close the app and open it again.");
    return false;
  }, []);

  /* Restore session on start, or open the local profile */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedUser = readSavedUser();
      const token = readSavedToken();
      if (token && savedUser && savedUser.local === true) {
        setUser(savedUser);
      } else {
        clearAuth();
        await openLocalProfile();
      }
      if (!cancelled) setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [openLocalProfile]);

  // No accounts: nothing to sign out of. Kept so pages can pass it through.
  function handleSignOut() {}

  /* Backend rejected the saved token: fall back to the local profile */
  useEffect(() => {
    async function onExpired() {
      clearAuth();
      setUser(null);
      await openLocalProfile();
    }
    window.addEventListener("app:session-expired", onExpired);
    return () => window.removeEventListener("app:session-expired", onExpired);
  }, [openLocalProfile]);

  if (!authReady || (!user && !startError)) {
    return (
      <div className="app-boot" role="status">
        <span className="app-boot-spinner" aria-hidden="true" />
        <span>
          Starting SmartShot…
          {slowStart ? (
            <span className="app-boot-note">
              The first start after installing can take a minute while Windows checks the app.
            </span>
          ) : null}
        </span>
      </div>
    );
  }

  if (!user && startError) {
    return (
      <div className="app-boot" role="alert">
        {startError}
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/search" replace />} />
      <Route path="/search" element={<SearchPage user={user} onSignOut={handleSignOut} />} />
      <Route path="/saved" element={<Saved user={user} onSignOut={handleSignOut} />} />
      <Route path="/history" element={<History user={user} onSignOut={handleSignOut} />} />
      <Route path="/profile" element={<Profile user={user} onSignOut={handleSignOut} />} />
      <Route path="/knowledge" element={<Knowledge user={user} onSignOut={handleSignOut} />} />

      <Route path="*" element={<Navigate to="/search" replace />} />
    </Routes>
  );
}
