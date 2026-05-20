// client/src/CreateAccount.js
import React, { useState } from "react";
import api from "./api";
import "./CreateAccount.css";

const DESKTOP_GOOGLE_TIMEOUT_MS = 5 * 60 * 1000;
const DESKTOP_GOOGLE_POLL_MS = 900;

export default function CreateAccount({ onRegistered, onShowLogin }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const isDesktopApp = Boolean(window.electronAPI?.openExternal);

  function passwordStrength(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score;
  }

  const strength = passwordStrength(password);
  const strengthLabels = ["", "Too short", "Weak", "Okay", "Strong"];

  /* ---------- Register with email/password ---------- */
  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("Please fill all fields.");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post("/api/auth/register", {
        name: name.trim(),
        email: email.trim(),
        password,
      });

      const { token, user, requiresVerification, message } = res.data || {};
      if (requiresVerification) {
        setSuccess(message || "Verification email sent. Please verify to sign in.");
        return;
      }
      if (!token || !user) throw new Error("Invalid registration response");

      onRegistered?.({ token, user });
    } catch (err) {
      console.error("Register error:", err);
      setError(
        err?.response?.data?.message ||
          err.message ||
          "Registration failed"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleDesktopGoogleRegister() {
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const start = await api.post("/api/auth/google/desktop/start");
      const sessionId = String(start?.data?.sessionId || "").trim();
      const authUrl = String(start?.data?.authUrl || "").trim();
      if (!sessionId || !authUrl) {
        throw new Error("Could not start desktop Google sign-up");
      }

      const opened = await window.electronAPI.openExternal(authUrl);
      if (!opened) {
        throw new Error("Could not open browser for Google sign-up");
      }

      setSuccess("Complete Google sign-in in your browser. Waiting for confirmation...");

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
        onRegistered?.({ token, user });
        return;
      }

      throw new Error("Google sign-in timed out. Browser callback was not completed in time.");
    } catch (err) {
      console.error("Desktop Google register error:", err);
      const numericErr =
        typeof err === "number" || (typeof err === "string" && /^\d+$/.test(err));
      const numericMsg = numericErr ? `Google sign-up failed (error ${err}).` : "";
      setError(
        err?.response?.data?.message ||
          err.message ||
          numericMsg ||
          "Google sign-up failed"
      );
    } finally {
      setLoading(false);
    }
  }

  /* ---------- Guest access (renderer-only) ---------- */
  function handleGuest() {
    if (typeof onRegistered === "function") {
      onRegistered({
        user: {
          id: "guest",
          name: "Guest",
          guest: true,
        },
      });
    }
  }

  return (
    <div className="reg-root">
      <div className="reg-card">
        <div className="reg-left">
          <div className="reg-image-wrap">
            <img
              src={`${process.env.PUBLIC_URL}/register-illustration.png`}
              alt="illustration"
              className="reg-image"
            />
          </div>

          <div className="left-cta">
            {isDesktopApp ? (
              <button
                className="reg-btn-ghost-left"
                type="button"
                onClick={handleDesktopGoogleRegister}
                disabled={loading}
              >
                Continue with Google
              </button>
            ) : (
              <div className="reg-success">Google sign-up is available in desktop app only.</div>
            )}
            <button
              className="reg-btn-ghost-left"
              type="button"
              onClick={handleGuest}
              disabled={loading}
            >
              Continue as Guest
            </button>
          </div>
        </div>

        <div className="reg-right">
          <div className="reg-top">
            <h1>Create account</h1>
            <p className="muted">
              Sign up to access Visual Memory Search App
            </p>
          </div>

          <form className="reg-form" onSubmit={handleRegister}>
            <input
              className="reg-input"
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />

            <input
              className="reg-input"
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              className="reg-input pw"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <div className="pw-row">
              <div className="pw-bar">
                <div className={`pw-fill s${strength}`} />
              </div>
              <div className="pw-label">
                {strengthLabels[strength] || ""}
              </div>
            </div>

            {error && <div className="reg-error">{error}</div>}
            {success && <div className="reg-success">{success}</div>}

            <button className="reg-btn" type="submit" disabled={loading}>
              {loading ? "Registering..." : "Register"}
            </button>

            <div className="reg-footer">
              Already registered?{" "}
              <button
                type="button"
                className="link-like"
                onClick={onShowLogin}
              >
                Login
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
