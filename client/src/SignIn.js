<<<<<<< HEAD
// client/src/SignIn.js
import React, { useState } from "react";
import api from "./api";
import "./SignIn.css";

const DESKTOP_GOOGLE_TIMEOUT_MS = 5 * 60 * 1000;
const DESKTOP_GOOGLE_POLL_MS = 900;
=======
import React, { useState } from "react";
import axios from "axios";
import "./SignIn.css";

const API_BASE = process.env.REACT_APP_API_BASE || "http://127.0.0.1:5000";

>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8

export default function SignIn({ onAuth, onShowRegister }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
<<<<<<< HEAD
  const [notice, setNotice] = useState("");
  const isDesktopApp = Boolean(window.electronAPI?.openExternal);

  /* ---------- Email/password login ---------- */
  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);

    try {
      const res = await api.post("/api/auth/login", { email, password });
      const { token, user } = res.data || {};

      if (!token || !user) {
        throw new Error("Invalid login response");
      }

      onAuth?.({ token, user });
    } catch (err) {
      console.error("Login error:", err);
      setError(
        err?.response?.data?.message ||
          err.message ||
          "Login failed"
      );
=======

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await axios.post(`${API_BASE}/api/auth/login`, { email, password });
      const { token, user } = res.data;

      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));

      onAuth && onAuth(user);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Login failed");
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
    } finally {
      setLoading(false);
    }
  }

<<<<<<< HEAD
  async function handleResendVerification() {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Enter your email to resend verification.");
      return;
    }

    setLoading(true);
    try {
      let res;
      try {
        res = await api.post("/api/auth/resend-verification", {
          email: email.trim(),
        });
      } catch (err) {
        if (err?.response?.status === 404) {
          res = await api.post("/api/auth/resend", { email: email.trim() });
        } else {
          throw err;
        }
      }
      setNotice(res?.data?.message || "Verification email sent.");
    } catch (err) {
      console.error("Resend verification error:", err);
      setError(
        err?.response?.data?.message ||
          err.message ||
          "Failed to resend verification"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleDesktopGoogleLogin() {
    setError("");
    setNotice("");
    setLoading(true);

    try {
      const start = await api.post("/api/auth/google/desktop/start");
      const sessionId = String(start?.data?.sessionId || "").trim();
      const authUrl = String(start?.data?.authUrl || "").trim();
      if (!sessionId || !authUrl) {
        throw new Error("Could not start desktop Google sign-in");
      }

      const opened = await window.electronAPI.openExternal(authUrl);
      if (!opened) {
        throw new Error("Could not open browser for Google sign-in");
      }

      setNotice("Complete Google sign-in in your browser. Waiting for confirmation...");

      const startedAt = Date.now();
      while (Date.now() - startedAt < DESKTOP_GOOGLE_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, DESKTOP_GOOGLE_POLL_MS));
        const poll = await api.get("/api/auth/google/desktop/poll", {
          params: { sessionId },
        });
        const status = String(poll?.data?.status || "").toLowerCase();
        if (status === "pending") continue;
        if (status !== "complete") continue;

        const token = poll?.data?.token;
        const user = poll?.data?.user;
        if (!token || !user) throw new Error("Missing auth payload");
        onAuth?.({ token, user });
        return;
      }

      throw new Error("Google sign-in timed out. Browser callback was not completed in time.");
    } catch (err) {
      console.error("Desktop Google login error:", err);
      const numericErr =
        typeof err === "number" || (typeof err === "string" && /^\d+$/.test(err));
      const numericMsg = numericErr ? `Google login failed (error ${err}).` : "";
      setError(
        err?.response?.data?.message ||
          err.message ||
          numericMsg ||
          "Google login failed"
      );
    } finally {
      setLoading(false);
    }
  }

  /* ---------- Guest login (renderer-only) ---------- */
  function handleGuest() {
    if (typeof onAuth === "function") {
      onAuth({
        user: {
          id: "guest",
          name: "Guest",
          guest: true,
        },
      });
    }
  }

  return (
    <div className="signin-root">
      <div className="signin-card">
        {/* LEFT PANEL */}
        <div className="signin-left">
          <div className="signin-image-wrap">
            <img
              src={`${process.env.PUBLIC_URL}/signin-illustration.png`}
=======
  return (
    <div className="signin-root">
      <div className="signin-card">

        {/* LEFT IMAGE PANEL */}
        <div className="signin-left">
          <div className="signin-image-wrap">
            <img
              src="/signin-illustration.png"
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
              alt="Illustration"
              className="signin-image"
            />
          </div>
<<<<<<< HEAD

          <div className="left-cta">
            {isDesktopApp ? (
              <button
                className="btn-guest-left"
                onClick={handleDesktopGoogleLogin}
                disabled={loading}
              >
                Continue with Google
              </button>
            ) : (
              <div className="signin-notice">Google sign-in is available in desktop app only.</div>
            )}
            <button
              className="btn-guest-left"
              onClick={handleGuest}
              disabled={loading}
            >
              Continue as Guest
            </button>
          </div>
        </div>

        {/* RIGHT PANEL */}
=======
        </div>

        {/* RIGHT FORM PANEL */}
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
        <div className="signin-right">
          <h2 className="signin-title">Sign In</h2>
          <p className="signin-sub">Unlock your world.</p>

          <form onSubmit={handleSubmit}>
            <label className="field-label">
              Email <span className="required">*</span>
            </label>
            <input
              className="field-input"
              type="email"
<<<<<<< HEAD
=======
              placeholder="Enter your email"
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <label className="field-label">
              Password <span className="required">*</span>
            </label>
            <input
              className="field-input"
              type="password"
<<<<<<< HEAD
=======
              placeholder="Enter your password"
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && <div className="signin-error">{error}</div>}
<<<<<<< HEAD
            {notice && <div className="signin-notice">{notice}</div>}
            {error && error.toLowerCase().includes("not verified") ? (
              <button
                type="button"
                className="btn-resend"
                onClick={handleResendVerification}
                disabled={loading}
              >
                Resend verification email
              </button>
            ) : null}
=======
>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8

            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={onShowRegister}
            >
              Create an account
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
<<<<<<< HEAD
=======

>>>>>>> e602d9f76dae2518e38a65a9afec0f77ae0358a8
