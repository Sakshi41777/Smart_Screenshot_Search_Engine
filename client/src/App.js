// client/src/App.js
<<<<<<< HEAD
import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";

import Welcome from "./Welcome";
import SignIn from "./SignIn";
import CreateAccount from "./CreateAccount";
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
  return localStorage.getItem("APP_TOKEN");
}

function persistAuth({ token, user }) {
  localStorage.removeItem("APP_TOKEN");
  localStorage.removeItem("APP_USER");

  if (token) localStorage.setItem("APP_TOKEN", token);
  if (user) localStorage.setItem("APP_USER", JSON.stringify(user));
}

/* ---------- App ---------- */
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false); // 🔥 NEW

  /* Restore session on refresh */
  useEffect(() => {
    const savedUser = readSavedUser();
    const token = readSavedToken();

    if (savedUser) {
      setUser(savedUser);
    } else if (token) {
      // token exists but user not yet fetched
      setUser({ tokenOnly: true });
    }

    setAuthReady(true); // 🔥 auth state resolved
  }, []);

  /* 🔥 AUTO-CLEAR GUEST WHEN OPENING AUTH PAGES */
  useEffect(() => {
    if (
      authReady &&
      user?.guest === true &&
      (location.pathname === "/signin" || location.pathname === "/register")
    ) {
      localStorage.removeItem("APP_USER");
      setUser(null);
    }
  }, [location.pathname, user, authReady]);

  /* Unified auth handler */
  function handleAuth({ token, user }) {
    // Guest login
    if (user?.guest === true) {
      localStorage.setItem("APP_USER", JSON.stringify(user));
      setUser(user);
      navigate("/search", { replace: true });
      return;
    }

    // Normal login / register / Google
    if (!token || !user) {
      console.error("Invalid auth payload");
      return;
    }

    persistAuth({ token, user });
    setUser(user);
    navigate("/search", { replace: true });
  }

  function handleSignOut() {
    localStorage.clear();
    setUser(null);
    navigate("/", { replace: true });
  }

  // 🔥 WAIT until auth is ready (THIS FIXES EVERYTHING)
  if (!authReady) {
    return null; // or loader
  }

  const isGuest = Boolean(user?.guest === true);
  const isAuthed = Boolean(user && !isGuest);

  return (
    <Routes>
      {/* Welcome */}
      <Route
        path="/"
        element={
          isAuthed ? <Navigate to="/search" replace /> : <Welcome onAuth={handleAuth} />
        }
      />

      {/* Explicit Welcome page (used by profile edit action) */}
      <Route
        path="/welcome"
        element={<Welcome onAuth={handleAuth} />}
      />

      {/* Sign In */}
      <Route
        path="/signin"
        element={
          isAuthed ? (
            <Navigate to="/search" replace />
          ) : (
            <SignIn
              onAuth={handleAuth}
              onShowRegister={() => navigate("/register")}
            />
          )
        }
      />

      {/* Register */}
      <Route
        path="/register"
        element={
          isAuthed ? (
            <Navigate to="/search" replace />
          ) : (
            <CreateAccount
              onRegistered={handleAuth}
              onShowLogin={() => navigate("/signin")}
            />
          )
        }
      />

      {/* Search (guest + auth allowed) */}
      <Route
        path="/search"
        element={
          user ? (
            <SearchPage user={user} onSignOut={handleSignOut} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />

      {/* Auth-only routes */}
      <Route
        path="/profile"
        element={
          isAuthed ? (
            <Profile user={user} onSignOut={handleSignOut} />
          ) : (
            <Navigate to="/signin" replace />
          )
        }
      />

      <Route
        path="/saved"
        element={
          isAuthed ? (
            <Saved user={user} onSignOut={handleSignOut} />
          ) : (
            <Navigate to="/signin" replace />
          )
        }
      />

      <Route
        path="/history"
        element={
          isAuthed ? (
            <History user={user} onSignOut={handleSignOut} />
          ) : (
            <Navigate to="/signin" replace />
          )
        }
      />

      <Route
        path="/knowledge"
        element={
          isAuthed ? (
            <Knowledge user={user} onSignOut={handleSignOut} />
          ) : (
            <Navigate to="/signin" replace />
          )
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
=======
import React, { useState, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";

import SignIn from "./SignIn";
import CreateAccount from "./CreateAccount";
import Welcome from "./Welcome";

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  // Load saved login session
  useEffect(() => {
    const saved = localStorage.getItem("auth_user");
    if (saved) {
      setUser(JSON.parse(saved));
    }
  }, []);

  // Called when SignIn is successful
  function handleAuth(userData) {
    setUser(userData);
    navigate("/welcome");
  }

  return (
    <Routes>

      {/* PUBLIC ROUTES */}
      <Route
        path="/"
        element={<SignIn onAuth={handleAuth} onShowRegister={() => navigate("/register")} />}
      />

      <Route
        path="/register"
        element={<CreateAccount onShowLogin={() => navigate("/")} />}
      />

      {/* PROTECTED ROUTE */}
      <Route
        path="/welcome"
        element={user ? <Welcome /> : <Navigate to="/" replace />}
      />

      {/* DEFAULT REDIRECT */}
      <Route path="*" element={<Navigate to="/" replace />} />

>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
    </Routes>
  );
}
