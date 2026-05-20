// client/src/components/TopNav.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./TopNav.css";

export default function TopNav({ user, onSignOut }) {
  const navigate = useNavigate();
  const [notice, setNotice] = useState(null);

  const isGuest = Boolean(user?.guest === true);
  const isAuthed = Boolean(user && !isGuest);

  function showNotice(msg, ms = 3000) {
    setNotice(msg);
    setTimeout(() => setNotice(null), ms);
  }

  function handleHome() {
    navigate("/search");
  }

  function handleSaved() {
    if (!isAuthed) {
      showNotice("Please sign in to see your saved items.");
      return;
    }
    navigate("/saved");
  }

  function handleHistory() {
    if (!isAuthed) {
      showNotice("Please sign in to see your past searches.");
      return;
    }
    navigate("/history");
  }

  function handleProfile() {
    if (!isAuthed) {
      showNotice("Please sign in to open your profile.");
      return;
    }
    navigate("/profile");
  }

  function handleSignIn() {
    navigate("/signin");
  }

  function handleSignOutClick() {
    onSignOut?.();
  }

  const rawName = isGuest ? "Guest" : user?.name || user?.email || "User";
  const cleanName = String(rawName || "User").split("@")[0];
  const greeting = `Hello, ${cleanName}`;

  return (
    <>
      <div className="sp-topnav" role="navigation">
        <div className="sp-nav-left">
          <button className="nav-link" onClick={handleHome}>Home</button>
          <button className="nav-link" onClick={handleSaved}>Saved</button>
          <button className="nav-link" onClick={handleHistory}>History</button>
          <button className="nav-link" onClick={handleProfile}>Profile</button>
        </div>

        <div className="sp-nav-right">
          {isGuest && <span className="guest-pill">Guest</span>}
          {!isGuest && <span className="nav-user">{greeting}</span>}

          {!isAuthed ? (
            <button className="btn-primary" onClick={handleSignIn}>
              Sign in
            </button>
          ) : (
            <button className="btn-reset" onClick={handleSignOutClick}>
              Log out
            </button>
          )}
        </div>
      </div>

      <div className="sp-notice-wrap" aria-live="polite">
        {notice && <div className="sp-notice">{notice}</div>}
      </div>
    </>
  );
}
