import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import TopNav from "../components/TopNav";
import Icon from "../components/Icon";
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

  function entryTime(h) {
    const ts = h.timestamp || h.createdAt || h.created_at || h.updatedAt || h.updated_at;
    const d = ts ? new Date(ts) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }

  function dayLabel(d) {
    if (!d) return "Earlier";
    const today = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  }

  function folderName(h) {
    const p = String(h.folderPath || h.path || "").replace(/[\\/]+$/, "");
    return p ? p.split(/[\\/]/).pop() : "";
  }

  const groups = [];
  for (const h of history) {
    const label = dayLabel(entryTime(h));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(h);
    else groups.push({ label, items: [h] });
  }

  return (
    <div className="sp-root">
      <TopNav user={user} onSignOut={onSignOut} />

      <main className="pg-main">
        <header className="pg-head">
          <div>
            <h1>History</h1>
            <p>Your recent searches. Run any of them again with one click.</p>
          </div>
          {!isGuest && !loading && !error && history.length > 0 ? (
            <div className="pg-head-actions">
              <button type="button" className="sx-ghost-btn" onClick={toggleSelectAll}>
                {selectedIds.size === history.length ? "Clear selection" : "Select all"}
              </button>
              {selectedIds.size > 0 ? (
                <button type="button" className="sx-ghost-btn" onClick={removeSelected}>
                  <Icon name="trash" size={15} />
                  Remove {selectedIds.size}
                </button>
              ) : null}
              <button type="button" className="pg-danger-btn" onClick={clearAllHistory}>
                Clear history
              </button>
            </div>
          ) : null}
        </header>

        {isGuest ? (
          <div className="sx-empty">
            <span className="sx-empty-icon"><Icon name="clock" size={26} /></span>
            <h2>Sign in to keep your history</h2>
            <p>Guests can search, but past searches are only saved for signed-in accounts.</p>
            <button type="button" className="sx-primary-btn" onClick={handleSignIn}>Sign in</button>
          </div>
        ) : loading && !history.length ? (
          <div className="pg-loading">Loading your history…</div>
        ) : error ? (
          <div className="sp-alert" role="alert">
            <span className="sp-alert-icon" aria-hidden="true">!</span>
            {error}
          </div>
        ) : !history.length ? (
          <div className="sx-empty">
            <span className="sx-empty-icon"><Icon name="clock" size={26} /></span>
            <h2>No searches yet</h2>
            <p>Your searches will appear here so you can run them again quickly.</p>
            <button type="button" className="sx-primary-btn" onClick={() => navigate("/search")}>
              <Icon name="search" size={16} />
              Go to search
            </button>
          </div>
        ) : (
          <div className="hx-timeline">
            {groups.map((group) => (
              <section key={group.label} className="hx-group">
                <h2 className="hx-day">{group.label}</h2>
                <div className="hx-list">
                  {group.items.map((h, idx) => {
                    const id = getItemId(h);
                    const key = id || `${group.label}-${idx}`;
                    const d = entryTime(h);
                    const folder = folderName(h);
                    const checked = selectedIds.has(id);
                    return (
                      <div key={key} className={`hx-row ${checked ? "is-checked" : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(id)}
                          aria-label={`Select ${h.title || h.query || "search"}`}
                        />
                        <span className="hx-icon"><Icon name="search" size={16} /></span>
                        <div className="hx-text">
                          <div className="hx-query">{h.title || h.query || "Search"}</div>
                          <div className="hx-meta">
                            {d ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : ""}
                            {folder ? (
                              <span className="hx-folder">
                                <Icon name="folder" size={13} />
                                {folder}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <button type="button" className="sx-ghost-btn hx-run" onClick={() => rerunEntry(h)}>
                          Run again
                        </button>
                        <button
                          type="button"
                          className="sb-icon-btn"
                          aria-label="Remove from history"
                          title="Remove"
                          onClick={() => removeEntry(h)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
