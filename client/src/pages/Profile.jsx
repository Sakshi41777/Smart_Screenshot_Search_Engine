// client/src/pages/Profile.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import TopNav from "../components/TopNav";
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
        if (err?.response?.status === 401) {
          setError("Session expired. Please sign in again.");
        } else {
          setError(""); // don't show network hiccup as a prominent error
        }
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

  // If completely unauthenticated — show sign-in CTA
  if (!user && !isGuest) {
    return (
      <div className="sp-root">
        <TopNav user={null} onSignOut={handleSignOutLocal} />
        <div style={{ marginTop: 12 }} />
        <div className="sp-body" style={{ gridTemplateColumns: "1fr" }}>
          <main style={{ gridColumn: "1 / -1" }}>
            <div className="sp-card">
              <h2>Profile</h2>
              <div style={{ padding: 12 }}>
                <p>You are not signed in.</p>
                <div style={{ marginTop: 12 }}>
                  <button className="btn-primary" onClick={() => navigate("/signin")}>Sign in / Register</button>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="sp-root">
      <TopNav user={user} onSignOut={handleSignOutLocal} />

      <div style={{ marginTop: 12 }} />

      <div className="sp-body" style={{ gridTemplateColumns: "1fr" }}>
        <main style={{ gridColumn: "1 / -1" }}>
          <div className="sp-card">
            <h2>Profile</h2>

            {isGuest ? (
              <div>
                <p className="guest-banner">
                  You are using the app as a <strong>Guest</strong>. Sign in to save items, view your past searches, and personalize your profile.
                </p>
                <div style={{ marginTop: 12 }}>
                  <button className="btn-primary" onClick={() => navigate("/signin")}>Sign in / Register</button>
                </div>
              </div>
            ) : (
              <div>
                {loading && <div>Loading profile…</div>}
                {error && <div style={{ color: "#b92222" }}>{error}</div>}

                {!loading && (
                  <>
                    <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 10 }}>
                      <div style={{ flex: 1 }}>
                        {/* show profile fields, falling back to user prop if profile is not available */}
                        <div style={{ fontSize: 18, fontWeight: 700 }}>
                          {profile?.name || user?.name || profile?.fullName || profile?.displayName || "—"}
                        </div>
                        <div style={{ color: "var(--muted)", marginTop: 6 }}>
                          {profile?.email || user?.email || "—"}
                        </div>
                        {profile?.bio && <div style={{ marginTop: 10 }}>{profile.bio}</div>}
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <button className="btn-outline" onClick={() => navigate("/welcome")}>Edit profile</button>
                        <div style={{ height: 8 }} />
                        <button className="btn-reset" onClick={handleSignOutLocal}>Log out</button>
                      </div>
                    </div>

                    <hr style={{ margin: "18px 0", border: "none", borderTop: "1px solid #f3f7fb" }} />

                    <div>
                      <strong>Account details</strong>
                      <div style={{ marginTop: 8, color: "var(--muted)" }}>
                        <div>
                          Joined:&nbsp;
                          {profile?.createdAt
                            ? new Date(profile.createdAt).toLocaleDateString()
                            : (profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : (user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"))
                          }
                        </div>
                        <div>Email verified: {(profile?.emailVerified || profile?.email_verified || user?.emailVerified) ? "Yes" : "No"}</div>
                        {!(profile?.emailVerified || profile?.email_verified || user?.emailVerified) ? (
                          <div className="verify-banner">
                            <div className="verify-text">
                              Please verify your email to unlock all features.
                            </div>
                            <div className="verify-actions">
                              <button className="btn-outline" onClick={handleResendVerification}>
                                Resend verification email
                              </button>
                            </div>
                            {verifyNotice && <div className="verify-notice">{verifyNotice}</div>}
                            {verifyError && <div className="verify-error">{verifyError}</div>}
                          </div>
                        ) : null}
                        <div style={{ marginTop: 10 }}>
                          <button className="btn-outline" onClick={() => navigate("/saved")}>View saved items</button>
                          <button className="btn-outline" style={{ marginLeft: 8 }} onClick={() => navigate("/history")}>View history</button>
                        </div>
                      </div>
                    </div>

                    <hr style={{ margin: "18px 0", border: "none", borderTop: "1px solid #f3f7fb" }} />

                    <section className="knowledge-card">
                      <h3>Knowledge Center</h3>
                      <p className="knowledge-text">
                        This app prepares your folders for search, reads text inside many files,
                        and helps you find what you need using simple filters.
                      </p>
                      <div className="knowledge-mini-list">
                        <div>1. Choose a folder to prepare for search.</div>
                        <div>2. Use filters like file kind, text, date, and size.</div>
                        <div>3. Open any result and use actions like Save, Copy, Share, or Ask.</div>
                      </div>
                      <div className="knowledge-keywords">
                        {suggestedKeywords.map((keyword) => (
                          <span key={keyword} className="keyword-chip">
                            {keyword}
                          </span>
                        ))}
                      </div>
                      <button
                        className="btn-outline"
                        type="button"
                        onClick={() => navigate("/knowledge")}
                      >
                        Read More About Usage
                      </button>
                    </section>

                    <hr style={{ margin: "18px 0", border: "none", borderTop: "1px solid #f3f7fb" }} />

                    <section className="privacy-card">
                      <h3>Background Indexing & Privacy</h3>
                      <p className="knowledge-text">
                        Keep search ready in the background. Only selected folders are monitored.
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

                    <hr style={{ margin: "18px 0", border: "none", borderTop: "1px solid #f3f7fb" }} />

                    <section className="reset-card">
                      <h3>Reset App</h3>
                      <p className="knowledge-text">
                        Clear indexed files, saved items, and history to start fresh.
                      </p>
                      <button
                        className="btn-danger"
                        type="button"
                        onClick={handleResetApp}
                        disabled={resetBusy}
                      >
                        {resetBusy ? "Resetting..." : "Reset App Data"}
                      </button>
                      {resetNotice ? <div className="reset-notice">{resetNotice}</div> : null}
                      {resetError ? <div className="reset-error">{resetError}</div> : null}
                    </section>

                  </>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
