// client/src/pages/Profile.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import TopNav from "../components/TopNav";
import Icon from "../components/Icon";
import { setDisplayName, useDisplayName } from "../displayName";
import "./Profile.css";

function readSavedUser() {
  try {
    const u = localStorage.getItem("APP_USER") || localStorage.getItem("auth_user");
    if (u) return JSON.parse(u);
  } catch (e) {
    /* ignore parse errors */
  }
  return null;
}

export default function Profile({ user, onSignOut }) {
  const navigate = useNavigate();
  const isDesktopServiceAvailable = Boolean(
    window.electronAPI?.getBackgroundIndexSettings &&
      window.electronAPI?.setBackgroundIndexSettings
  );
  const currentName = useDisplayName();
  const [nameDraft, setNameDraft] = useState(currentName);
  const [nameNotice, setNameNotice] = useState("");
  useEffect(() => {
    setNameDraft(currentName);
  }, [currentName]);

  function saveName(e) {
    e?.preventDefault?.();
    const saved = setDisplayName(nameDraft);
    setNameNotice(saved ? `Saved. SmartShot will call you ${saved}.` : "Name removed.");
    setTimeout(() => setNameNotice(""), 2500);
  }

  function removeName() {
    setDisplayName("");
    setNameDraft("");
    setNameNotice("Name removed.");
    setTimeout(() => setNameNotice(""), 2500);
  }

  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [verifyNotice, setVerifyNotice] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState("");
  const [resetError, setResetError] = useState("");
  const [bgLoading, setBgLoading] = useState(false);
  const [bgSaving, setBgSaving] = useState(false);
  const [bgConsent, setBgConsent] = useState(false);
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgStrictPrivacy, setBgStrictPrivacy] = useState(false);
  const [bgKeepInTray, setBgKeepInTray] = useState(true);
  const [bgRunAtStartup, setBgRunAtStartup] = useState(true);
  const [bgUseSpecificFolders, setBgUseSpecificFolders] = useState(false);
  const [bgFolders, setBgFolders] = useState([]);
  const [bgStatusText, setBgStatusText] = useState("");
  const [bgMessage, setBgMessage] = useState("");
  const [bgError, setBgError] = useState("");
  const suggestedKeywords = [
    "find duplicate screenshots",
    "summarize this selected file",
    "find files with error logs",
    "find images without text",
    "show recent invoices in folder",
    "find similar UI screenshots",
  ];

  // treat explicit guest flag as guest
  const isGuest = Boolean(user && user.guest === true);

  useEffect(() => {
    // if guest or not logged in: clear profile and bail
    if (!user || isGuest) {
      setProfile(null);
      setError("");
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      setLoading(true);
      setError("");

      // If user is token-only (no profile fields), try localStorage first
      const savedUser = readSavedUser();
      if (user && user.tokenOnly && savedUser) {
        if (mounted) setProfile(savedUser);
      }

      try {
        // attempt to fetch authoritative profile from server
        const res = await api.get("/api/user/me");
        // server might return { user: {...} } or directly the user object
        const data = res?.data?.user ?? res?.data ?? null;
        if (mounted) setProfile(data || savedUser || user || null);
      } catch (err) {
        // If server call fails, fallback to saved user or provided user prop
        console.warn("Failed to fetch /api/user/me — falling back to saved user or prop", err);
        if (mounted) setProfile(savedUser || user || null);
        // store non-blocking message
        // 401s are handled app-wide (falls back to the local profile).
        setError("");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [user, isGuest]);

  useEffect(() => {
    if (isGuest) return;
    if (!isDesktopServiceAvailable) return;
    let mounted = true;
    (async () => {
      setBgLoading(true);
      setBgError("");
      try {
        const data = await window.electronAPI.getBackgroundIndexSettings();
        if (!mounted || !data) return;
        setBgConsent(Boolean(data.consentGiven));
        setBgEnabled(Boolean(data.enabled));
        setBgStrictPrivacy(data.strictPrivacy !== false);
        setBgKeepInTray(data.keepRunningInTray !== false);
        setBgRunAtStartup(data.runAtStartup !== false);
        setBgUseSpecificFolders(Boolean(data.useSpecificFolders));
        setBgFolders(Array.isArray(data.folders) ? data.folders : []);
        const running = Boolean(data?.status?.running);
        const watched = Number(data?.status?.watched || 0);
        setBgStatusText(running ? `Running on ${watched} folder(s)` : "Not running");
      } catch (err) {
        if (mounted) setBgError("Could not load background settings.");
      } finally {
        if (mounted) setBgLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isGuest, isDesktopServiceAvailable]);

  async function handleResendVerification() {
    setVerifyNotice("");
    setVerifyError("");
    const email = profile?.email || user?.email || "";
    if (!email) {
      setVerifyError("Email not found.");
      return;
    }

    try {
      let res;
      try {
        res = await api.post("/api/auth/resend-verification", { email });
      } catch (err) {
        if (err?.response?.status === 404) {
          res = await api.post("/api/auth/resend", { email });
        } else {
          throw err;
        }
      }
      setVerifyNotice(res?.data?.message || "Verification email sent.");
    } catch (err) {
      console.error("Resend verification error:", err);
      setVerifyError(
        err?.response?.data?.message || err.message || "Failed to resend verification"
      );
    }
  }

  function handleSignOutLocal() {
    // clear both new and legacy keys
    try {
      localStorage.removeItem("APP_TOKEN");
      localStorage.removeItem("APP_USER");
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
    } catch (e) { /* ignore */ }

    if (typeof onSignOut === "function") {
      onSignOut();
    } else {
      navigate("/", { replace: true });
    }
  }

  async function handleResetApp() {
    const ok = window.confirm(
      "This will clear all indexed files, saved items, and history. Continue?"
    );
    if (!ok) return;

    const typed = window.prompt('Type RESET_APP to confirm');
    if (String(typed || "").trim().toUpperCase() !== "RESET_APP") {
      setResetError("Reset canceled. Confirmation text did not match.");
      setResetNotice("");
      return;
    }

    setResetBusy(true);
    setResetNotice("");
    setResetError("");
    try {
      const res = await api.post("/api/search/reset-app", { confirm: "RESET_APP" });
      if (res?.data?.ok) {
        setResetNotice("App reset complete. Everything is cleared.");
        window.alert("App data reset complete.");
      } else {
        setResetError("Reset could not be completed.");
      }
    } catch (err) {
      setResetError(err?.response?.data?.error || "Reset failed.");
    } finally {
      setResetBusy(false);
    }
  }

  async function handlePickBgFolders() {
    if (!window.electronAPI?.selectFolder) {
      setBgError("Folder picker is unavailable.");
      return;
    }
    const picked = await window.electronAPI.selectFolder();
    const rows = Array.isArray(picked)
      ? picked.map((p) => String(p || "").trim()).filter(Boolean)
      : [];
    if (!rows.length) return;
    const merged = Array.from(new Set([...(bgFolders || []), ...rows]));
    setBgFolders(merged);
    setBgMessage("");
  }

  function handleRemoveBgFolder(folder) {
    setBgFolders((prev) => prev.filter((f) => f !== folder));
  }

  async function handleSaveBackgroundSettings() {
    if (!isDesktopServiceAvailable) {
      setBgError("Open the Desktop app to use background indexing settings.");
      return;
    }
    setBgSaving(true);
    setBgMessage("");
    setBgError("");
    try {
      const payload = {
        consentGiven: bgConsent,
        enabled: bgEnabled,
        strictPrivacy: bgStrictPrivacy,
        keepRunningInTray: bgKeepInTray,
        runAtStartup: bgRunAtStartup,
        useSpecificFolders: bgUseSpecificFolders,
        folders: bgFolders,
      };
      const data = await window.electronAPI.setBackgroundIndexSettings(payload);
      const running = Boolean(data?.status?.running);
      const watched = Number(data?.status?.watched || 0);
      setBgStatusText(running ? `Running on ${watched} folder(s)` : "Not running");
      setBgMessage("Background settings saved.");
    } catch (err) {
      setBgError("Could not save background settings.");
    } finally {
      setBgSaving(false);
    }
  }

  return (
    <div className="sp-root">
      <TopNav user={user} onSignOut={handleSignOutLocal} />

      <main className="pg-main pf-main">
        <header className="pg-head">
          <div>
            <h1>Settings</h1>
            <p>Personalise SmartShot, keep your index up to date, or start fresh.</p>
          </div>
        </header>

        <section className="pf-card">
          <div className="pf-account">
            <span className="pf-avatar pf-avatar-letter" aria-hidden="true">
              {currentName ? currentName.charAt(0).toUpperCase() : <Icon name="user" size={22} />}
            </span>
            <div className="pf-account-text">
              <h2>
                Your name <span className="pf-optional">Optional</span>
              </h2>
              <p>
                Add a name to personalise the app, for example "Welcome back, Sakshi". It's only stored on
                this computer. Leave it empty if you prefer.
              </p>
            </div>
          </div>
          <form className="pf-name-row" onSubmit={saveName}>
            <input
              value={nameDraft}
              maxLength={40}
              placeholder="Your name"
              aria-label="Your name"
              onChange={(e) => setNameDraft(e.target.value)}
            />
            <button type="submit" className="sx-primary-btn" disabled={nameDraft.trim() === currentName}>
              Save
            </button>
            {currentName ? (
              <button type="button" className="sx-ghost-btn" onClick={removeName}>
                Remove name
              </button>
            ) : null}
          </form>
          {nameNotice ? <div className="pf-saved" role="status">{nameNotice}</div> : null}
        </section>

        <section className="pf-card privacy-card">
          <h3>Background indexing</h3>
          <p className="knowledge-text">
            Keep search up to date automatically. New and changed files in your folders are indexed while the app runs.
          </p>
                      {!isDesktopServiceAvailable ? (
                        <div className="reset-error">
                          Desktop background service is unavailable in browser mode.
                        </div>
                      ) : null}
                      {bgLoading ? <div>Loading settings...</div> : null}
                      <label className="privacy-check">
                        <input
                          type="checkbox"
                          checked={bgConsent}
                          onChange={(e) => setBgConsent(e.target.checked)}
                          disabled={!isDesktopServiceAvailable}
                        />
                        I allow background indexing
                      </label>
                      <label className="privacy-check">
                        <input
                          type="checkbox"
                          checked={bgEnabled}
                          onChange={(e) => setBgEnabled(e.target.checked)}
                          disabled={!isDesktopServiceAvailable}
                        />
                        Enable continuous folder watcher
                      </label>
                      <label className="privacy-check">
                        <input
                          type="checkbox"
                          checked={bgStrictPrivacy}
                          onChange={(e) => setBgStrictPrivacy(e.target.checked)}
                          disabled={!isDesktopServiceAvailable}
                        />
                        Strict privacy (index only approved folders)
                      </label>
                      <label className="privacy-check">
                        <input
                          type="checkbox"
                          checked={bgUseSpecificFolders}
                          onChange={(e) => setBgUseSpecificFolders(e.target.checked)}
                          disabled={!isDesktopServiceAvailable}
                        />
                        Use specific folders only (optional)
                      </label>
                      <label className="privacy-check">
                        <input
                          type="checkbox"
                          checked={bgKeepInTray}
                          onChange={(e) => setBgKeepInTray(e.target.checked)}
                          disabled={!isDesktopServiceAvailable}
                        />
                        Keep running when window is closed (tray mode)
                      </label>
                      <label className="privacy-check">
                        <input
                          type="checkbox"
                          checked={bgRunAtStartup}
                          onChange={(e) => setBgRunAtStartup(e.target.checked)}
                          disabled={!isDesktopServiceAvailable}
                        />
                        Start background indexing at system login
                      </label>
                      <div className="privacy-actions">
                        {bgUseSpecificFolders ? (
                          <button className="btn-outline" type="button" onClick={handlePickBgFolders}>
                            Specific Folders
                          </button>
                        ) : null}
                        <button
                          className="btn-outline"
                          type="button"
                          onClick={handleSaveBackgroundSettings}
                          disabled={bgSaving || !isDesktopServiceAvailable}
                        >
                          {bgSaving ? "Saving..." : "Save Background Settings"}
                        </button>
                      </div>
                      <div className="privacy-status">
                        {bgUseSpecificFolders
                          ? bgStatusText
                          : "Default: background indexing uses your system folders."}
                      </div>
                      {bgUseSpecificFolders && bgFolders.length ? (
                        <div className="privacy-folders">
                          {bgFolders.map((folder) => (
                            <div key={folder} className="privacy-folder-row">
                              <span>{folder}</span>
                              <button
                                className="btn-reset"
                                type="button"
                                onClick={() => handleRemoveBgFolder(folder)}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : bgUseSpecificFolders ? (
                        <div className="privacy-status">No folders selected.</div>
                      ) : null}
                      {bgMessage ? <div className="reset-notice">{bgMessage}</div> : null}
                      {bgError ? <div className="reset-error">{bgError}</div> : null}
        </section>

        <section className="pf-card reset-card">
          <h3>Reset app data</h3>
          <p className="knowledge-text">
            Clears indexed files so you can start fresh. Your files on disk are never touched.
          </p>
          <button className="pg-danger-btn" type="button" onClick={handleResetApp} disabled={resetBusy}>
            {resetBusy ? "Resetting…" : "Reset app data"}
          </button>
          {resetNotice ? <div className="reset-notice">{resetNotice}</div> : null}
          {resetError ? <div className="reset-error">{resetError}</div> : null}
        </section>

        <section className="pf-card pf-tour-card">
          <div>
            <h3>New here?</h3>
            <p className="knowledge-text">Take a one-minute tour of every feature. You can skip it at any time.</p>
          </div>
          <button
            type="button"
            className="sx-primary-btn"
            onClick={() => navigate("/search", { state: { tour: Date.now() } })}
          >
            Take the tour
          </button>
        </section>

        <section className="pf-card knowledge-card">
          <h3>How it works</h3>
          <div className="knowledge-mini-list">
            <div>1. Add a folder in the sidebar. Every file in it and its subfolders gets indexed.</div>
            <div>2. Search the words inside your screenshots, PDFs and documents, or search with a picture.</div>
            <div>3. Click a result to preview it, then open, save or ask about it.</div>
          </div>
          <div className="knowledge-keywords">
            {suggestedKeywords.map((keyword) => (
              <span key={keyword} className="keyword-chip">
                {keyword}
              </span>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
