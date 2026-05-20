import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import TopNav from "../components/TopNav";
import "./History.css";

export default function History({ user, onSignOut }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());

  const isGuest = Boolean(user && user.guest === true);

  useEffect(() => {
    let mounted = true;

    if (!user || isGuest) {
      setHistory([]);
      setSelectedIds(new Set());
      return () => {
        mounted = false;
      };
    }

    (async () => {
      setLoading(true);
      setError("");
      try {
        let res;
        try {
          res = await api.get("/api/search/history");
        } catch {
          res = await api.get("/api/history");
        }

        const data = res?.data;
        const loaded = Array.isArray(data)
          ? data
          : data?.items || data?.history || data?.data || [];

        if (!mounted) return;
        setHistory(loaded || []);
        setSelectedIds(new Set());
      } catch (err) {
        console.error("Could not load activity", err);
        if (!mounted) return;
        setError("Could not load activity.");
        setHistory([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [user, isGuest]);

  function handleSignIn() {
    navigate("/signin");
  }

  function getItemId(h) {
    return h?._id || h?.id || "";
  }

  function toggleSelect(id) {
    if (!id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!history.length) return;
    const allIds = history.map(getItemId).filter(Boolean);
    setSelectedIds((prev) => {
      if (prev.size === allIds.length) return new Set();
      return new Set(allIds);
    });
  }

  async function removeEntry(h) {
    if (!h) return;
    if (!window.confirm("Remove this activity item?")) return;

    const id = getItemId(h);
    const removeLocally = () => {
      setHistory((s) => s.filter((x) => getItemId(x) !== id && x !== h));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    };

    try {
      if (id) {
        try {
          await api.delete(`/api/search/history/${id}`);
        } catch (e) {
          if (e?.response?.status === 404) {
            removeLocally();
            return;
          }
          await api.delete(`/api/history/${id}`);
        }
        removeLocally();
      } else {
        removeLocally();
      }
    } catch (e) {
      console.error("Could not remove activity item", e);
      alert(e?.response?.data?.message || "Could not remove this activity item");
    }
  }

  async function removeSelected() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!window.confirm(`Remove ${ids.length} selected activity items?`)) return;

    try {
      try {
        await api.delete("/api/search/history", { data: { ids } });
      } catch {
        await api.delete("/api/history", { data: { ids } });
      }
      setHistory((prev) => prev.filter((h) => !selectedIds.has(getItemId(h))));
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Could not remove selected activity items", e);
      alert(e?.response?.data?.error || "Could not remove selected activity items");
    }
  }

  async function clearAllHistory() {
    if (!history.length) return;
    if (!window.confirm("Remove all activity items?")) return;

    try {
      try {
        await api.delete("/api/search/history");
      } catch {
        await api.delete("/api/history");
      }
      setHistory([]);
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Could not remove all activity", e);
      alert(e?.response?.data?.error || "Could not remove all activity");
    }
  }

  function rerunEntry(h) {
    if (!h) return;
    const q = h.query || h.title || h.path || h.folderPath || "";
    const rerunPath = h.folderPath || h.path || null;
    navigate("/search", { state: { query: q, path: rerunPath, autoRun: true } });
  }

  function renderDate(h) {
    const ts = h.timestamp || h.createdAt || h.created_at || h.updatedAt || h.updated_at;
    if (!ts) return "-";
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  }

  return (
    <div className="sp-root">
      <TopNav user={user} onSignOut={onSignOut} />

      <div style={{ marginTop: 12 }} />

      <div className="sp-body" style={{ gridTemplateColumns: "1fr" }}>
        <main style={{ gridColumn: "1 / -1" }}>
          <div className="sp-card">
            <h2>Recent Activity</h2>

            {isGuest ? (
              <div>
                <p className="guest-banner">
                  Recent activity is available after sign in. Sign in to keep your search history.
                </p>
                <div style={{ marginTop: 12 }}>
                  <button className="btn-primary" onClick={handleSignIn}>Sign in / Register</button>
                </div>
              </div>
            ) : (
              <div>
                {!loading && !error && history.length > 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    <button className="btn-outline" onClick={toggleSelectAll}>
                      {selectedIds.size === history.length ? "Clear Selection" : "Select All"}
                    </button>
                    <button
                      className="btn-outline"
                      onClick={removeSelected}
                      disabled={selectedIds.size === 0}
                    >
                      Remove Selected ({selectedIds.size})
                    </button>
                    <button className="btn-reset" onClick={clearAllHistory}>
                      Remove All
                    </button>
                  </div>
                ) : null}

                {loading && <div>Loading...</div>}
                {error && <div style={{ color: "#b92222" }}>{error}</div>}

                {!loading && !error && (
                  <>
                    {!history.length ? (
                      <div className="no-results" style={{ padding: 20 }}>
                        <div style={{ fontSize: 18, marginBottom: 8, fontWeight: 600 }}>
                          No activity yet.
                        </div>
                        <div style={{ color: "var(--muted)", marginBottom: 12 }}>
                          Your recent searches will appear here so you can run them again quickly.
                        </div>
                        <div>
                          <button className="btn-primary" onClick={() => navigate("/search")}>
                            Go to Search
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {history.map((h, idx) => {
                          const id = getItemId(h);
                          const key = id || idx;
                          return (
                            <div key={key} className="sp-card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <input
                                type="checkbox"
                                checked={selectedIds.has(id)}
                                onChange={() => toggleSelect(id)}
                                aria-label="Select activity item"
                              />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700 }}>{h.title || h.query || "Search item"}</div>
                                <div style={{ color: "var(--muted)" }}>{renderDate(h)}</div>
                              </div>
                              <div>
                                <button className="btn-outline" onClick={() => rerunEntry(h)}>Run Again</button>
                                <button className="btn-reset" style={{ marginLeft: 8 }} onClick={() => removeEntry(h)}>
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
