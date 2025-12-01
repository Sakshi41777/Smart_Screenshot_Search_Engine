// client/src/CreateAccount.js
import React, { useState } from "react";
import axios from "axios";
import "./CreateAccount.css";

const API_BASE = process.env.REACT_APP_API_BASE || "http://127.0.0.1:5000";

export default function CreateAccount({ onRegistered, onShowLogin }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function passwordStrength(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score += 1;
    if (/[A-Z]/.test(pw)) score += 1;
    if (/[0-9]/.test(pw)) score += 1;
    if (/[^A-Za-z0-9]/.test(pw)) score += 1;
    return score;
  }

  const strength = passwordStrength(password);
  const strengthLabels = ["", "Too short", "Weak", "Okay", "Strong"];

  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    setMsg("");

    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("Please fill all fields.");
      return;
    }

    setLoading(true);
    try {
      // use axios (was missing)
      await axios.post(`${API_BASE}/api/auth/register`, {
        name: name.trim(),
        email: email.trim(),
        password,
      });

      setMsg("Registered successfully. Please sign in.");
      // switch to login view
      onShowLogin && onShowLogin();
    } catch (err) {
      console.error("register err", err);
      setError(err?.response?.data?.message || err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="reg-root">
      <div className="reg-card">
        <div className="reg-left">
          <div className="reg-image-wrap">
            <img src="/register-illustration.png" alt="illustration" className="reg-image" />
          </div>
        </div>

        <div className="reg-right">
          <div className="reg-top">
            <h1>Create account</h1>
            <p className="muted">Sign up to access Visual Memory Search App</p>
          </div>

          <form className="reg-form" onSubmit={handleRegister}>
            <input className="reg-input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="reg-input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="reg-input pw" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />

            <div className="pw-row">
              <div className="pw-bar">
                <div className={`pw-fill s${strength}`} />
              </div>
              <div className="pw-label">{strengthLabels[strength] || ""}</div>
            </div>

            {error && <div className="reg-error">{error}</div>}
            {msg && <div className="reg-msg">{msg}</div>}

            <button className="reg-btn" type="submit" disabled={loading}>
              {loading ? "Registering..." : "Register"}
            </button>

            <div className="reg-footer">
              Already registered?{" "}
              <button type="button" className="link-like" onClick={() => onShowLogin && onShowLogin()}>
                Login
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
