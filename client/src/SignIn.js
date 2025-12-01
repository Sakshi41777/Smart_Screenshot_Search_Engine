import React, { useState } from "react";
import axios from "axios";
import "./SignIn.css";

const API_BASE = process.env.REACT_APP_API_BASE || "http://127.0.0.1:5000";


export default function SignIn({ onAuth, onShowRegister }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="signin-root">
      <div className="signin-card">

        {/* LEFT IMAGE PANEL */}
        <div className="signin-left">
          <div className="signin-image-wrap">
            <img
              src="/signin-illustration.png"
              alt="Illustration"
              className="signin-image"
            />
          </div>
        </div>

        {/* RIGHT FORM PANEL */}
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
              placeholder="Enter your email"
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
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && <div className="signin-error">{error}</div>}

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

