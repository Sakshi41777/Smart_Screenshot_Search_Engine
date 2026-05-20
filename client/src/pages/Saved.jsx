import React, { memo, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import TopNav from "../components/TopNav";
import "./Saved.css";

function getItemIdValue(it, fallbackIndex = -1) {
  return (
    it?._id ||
    it?.id ||
    (it?.path ? `path:${it.path}` : "") ||
    (it?.name ? `name:${it.name}:${fallbackIndex}` : "")
  );
}

function normalizeLoadedItems(rawItems = []) {
  const rows = Array.isArray(rawItems) ? rawItems : [];
  const unique = new Map();

  rows.forEach((it, idx) => {
    const key = String(it?.path || "").trim() || String(getItemIdValue(it, idx));
    if (!key) return;
    if (!unique.has(key)) unique.set(key, it);
  });

  return Array.from(unique.values()).sort((a, b) => {
    const au = new Date(a?.updatedAt || a?.createdAt || 0).getTime() || 0;
    const bu = new Date(b?.updatedAt || b?.createdAt || 0).getTime() || 0;
    if (bu !== au) return bu - au;
    const an = String(a?.name || a?.path || "").toLowerCase();
    const bn = String(b?.name || b?.path || "").toLowerCase();
    return an.localeCompare(bn);
  });
}

function isImageLikeItem(item = {}) {
  const ext = String(item?.path || "")
    .split(".")
    .pop()
    .toLowerCase();
  const type = String(item?.type || "").toLowerCase();
  return ["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext) || type === "image";
}

function getDocumentThumbDataUri(label = "DOC") {
  const safeLabel = String(label || "DOC").toUpperCase().slice(0, 4);
  return `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
  <rect width="320" height="200" rx="14" fill="#e2e8f0"/>
  <rect x="18" y="18" width="284" height="164" rx="12" fill="#cbd5e1"/>
  <rect x="30" y="56" width="72" height="88" rx="10" fill="#2563eb"/>
  <text x="66" y="106" text-anchor="middle" fill="#fff" font-size="21" font-family="Segoe UI, Arial" font-weight="700">${safeLabel}</text>
  <text x="122" y="84" fill="#0f172a" font-size="22" font-family="Segoe UI, Arial" font-weight="700">Document Preview</text>
  <text x="122" y="112" fill="#64748b" font-size="13" font-family="Segoe UI, Arial">Open folder to view original file.</text>
</svg>
`)}`;
}

function buildThumbSrc(item = {}) {
  const raw = String(item?.thumbnailUrl || "").trim();
  if (raw) return raw;

  if (isImageLikeItem(item) && item?.path) {
    const base = window?.BACKEND_BASE_URL || "http://127.0.0.1:5001";
    return `${base.replace(/\/+$/, "")}/api/thumbnail?path=${encodeURIComponent(
      item.path
    )}`;
  }

  const ext = String(item?.path || "").split(".").pop() || "DOC";
  return getDocumentThumbDataUri(ext);
}

const SavedThumbnail = memo(function SavedThumbnail({ item, alt }) {
  const primarySrc = buildThumbSrc(item);
  const fallbackSrc = isImageLikeItem(item)
    ? getDocumentThumbDataUri("IMG")
    : getDocumentThumbDataUri(String(item?.type || "DOC"));
  const [imgSrc, setImgSrc] = useState(primarySrc || fallbackSrc);

  useEffect(() => {
    setImgSrc(primarySrc || fallbackSrc);
  }, [primarySrc, fallbackSrc]);

  return (
    <img
      src={imgSrc}
      alt={alt}
      className="saved-thumb"
      loading="lazy"
      onError={() => {
        if (imgSrc !== fallbackSrc) setImgSrc(fallbackSrc);
      }}
    />
  );
});

export default function Saved({ user, onSignOut }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const hasLoadedOnceRef = useRef(false);
  const lastLoadedUserKeyRef = useRef("");

  const isGuest = Boolean(user && user.guest === true);
  const stableUserKey = user
    ? String(
        user?._id ||
          user?.id ||
          user?.email ||
          user?.username ||
          user?.name ||
          "authed-user"
      )
    : "";

  useEffect(() => {
    if (!stableUserKey || isGuest) {
      setItems([]);
      setSelectedIds(new Set());
      hasLoadedOnceRef.current = false;
      lastLoadedUserKeyRef.current = "";
      return;
    }

    if (
      hasLoadedOnceRef.current &&
      lastLoadedUserKeyRef.current === stableUserKey
    ) {
      return;
    }

    let mounted = true;

    (async () => {
      // Keep existing list visible while refreshing to avoid visual flicker.
      setLoading(!hasLoadedOnceRef.current);
      setError("");
      try {
        let res;
        try {
          res = await api.get("/api/items/favorites");
        } catch {
          res = await api.get("/api/saved");
        }

        const data = res?.data;
        const loaded = Array.isArray(data)
          ? data
          : data?.items || data?.saved || data?.data || [];

        if (!mounted) return;
        setItems(normalizeLoadedItems(loaded || []));
        setSelectedIds(new Set());
        hasLoadedOnceRef.current = true;
        lastLoadedUserKeyRef.current = stableUserKey;
      } catch (err) {
        console.error("Could not load saved items", err);
        if (!mounted) return;
        if (err?.response?.status === 401) return;
        setError(err?.response?.data?.message || "Could not load saved items.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [stableUserKey, isGuest]);

  function getItemId(it, fallbackIndex = -1) {
    return getItemIdValue(it, fallbackIndex);
  }

  function handleSignIn() {
    navigate("/signin");
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
    if (!items.length) return;
    const allIds = items.map((it, idx) => getItemId(it, idx)).filter(Boolean);
    setSelectedIds((prev) => {
      if (prev.size === allIds.length) return new Set();
      return new Set(allIds);
    });
  }

  async function openItem(it) {
    if (!it) return;

    if (it.path && window.electronAPI) {
      try {
        if (window.electronAPI?.showItemInFolder) {
          const ok = await window.electronAPI.showItemInFolder(it.path);
          if (ok) return;
        }
        if (window.electronAPI?.openPath) {
          const result = await window.electronAPI.openPath(it.path);
          if (!result) return;
        }
      } catch (e) {
        console.error("Could not open folder", e);
      }
    }

    const displayName =
      it.name || (it.path ? it.path.split(/[\\/]/).pop() : "Saved item");
    navigate("/search", {
      state: {
        query: displayName,
        path: it.path || null,
        autoRun: true,
      },
    });
  }

  async function handleRemove(it) {
    if (!it) return;
    const id = getItemId(it);
    if (!window.confirm("Remove this item?")) return;

    try {
      try {
        await api.delete(`/api/items/favorites/${id}`);
      } catch {
        await api.delete(`/api/saved/${id}`);
      }
      setItems((s) => s.filter((x, idx) => getItemId(x, idx) !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e) {
      console.error("Could not remove saved item", e);
      alert(e?.response?.data?.message || "Could not remove this item");
    }
  }

  async function removeSelected() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!window.confirm(`Remove ${ids.length} selected items?`)) return;

    try {
      try {
        await api.delete("/api/items/favorites", { data: { ids } });
      } catch {
        await api.delete("/api/saved", { data: { ids } });
      }
      setItems((prev) =>
        prev.filter((it, idx) => !selectedIds.has(getItemId(it, idx)))
      );
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Could not remove selected items", e);
      alert(e?.response?.data?.error || "Could not remove selected items");
    }
  }

  async function clearAllSaved() {
    if (!items.length) return;
    if (!window.confirm("Remove all saved items?")) return;

    try {
      try {
        await api.delete("/api/items/favorites");
      } catch {
        await api.delete("/api/saved");
      }
      setItems([]);
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Could not remove all saved items", e);
      alert(e?.response?.data?.error || "Could not remove all saved items");
    }
  }

  return (
    <div className="sp-root">
      <TopNav user={user} onSignOut={onSignOut} />

      <div style={{ marginTop: 12 }} />

      <div className="sp-body" style={{ gridTemplateColumns: "1fr" }}>
        <main style={{ gridColumn: "1 / -1" }}>
          <div className="sp-card">
            <h2>Saved Items</h2>

            {isGuest ? (
              <div>
                <p className="guest-banner">
                  Saved items are available after sign in. Sign in to keep
                  important files and open them quickly.
                </p>
                <div style={{ marginTop: 12 }}>
                  <button className="btn-primary" onClick={handleSignIn}>
                    Sign in / Register
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {!loading && !error && items.length > 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    <button className="btn-outline" onClick={toggleSelectAll}>
                      {selectedIds.size === items.length ? "Clear Selection" : "Select All"}
                    </button>
                    <button
                      className="btn-outline"
                      onClick={removeSelected}
                      disabled={selectedIds.size === 0}
                    >
                      Remove Selected ({selectedIds.size})
                    </button>
                    <button className="btn-reset" onClick={clearAllSaved}>
                      Remove All
                    </button>
                  </div>
                ) : null}

                {loading && items.length === 0 && <div>Loading...</div>}
                {error && <div style={{ color: "#b92222" }}>{error}</div>}

                {!loading && !error && (
                  <>
                    {items.length === 0 ? (
                      <div className="no-results" style={{ padding: 18 }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>
                          No saved items yet.
                        </div>
                        <div style={{ color: "var(--muted)" }}>
                          Open Search, find a file, and click "Save Item" to keep it here.
                        </div>
                        <div style={{ marginTop: 12 }}>
                          <button
                            className="btn-primary"
                            onClick={() => navigate("/search")}
                          >
                            Go to Search
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 12 }}>
                        {items.map((it, idx) => {
                          const id = getItemId(it, idx);
                          const displayName =
                            it.name ||
                            (it.path
                              ? it.path.split(/[\\/]/).pop()
                              : "Saved item");

                          const metaParts = [];
                          if (it.type) metaParts.push(it.type);
                          if (it.size) metaParts.push(it.size);

                          return (
                            <div
                              key={id}
                              className="result-row"
                              style={{ alignItems: "center" }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedIds.has(id)}
                                onChange={() => toggleSelect(id)}
                            aria-label="Select saved item"
                              />
                              <div className="result-left">
                                <SavedThumbnail
                                  item={it}
                                  alt={displayName}
                                />
                              </div>

                              <div style={{ flex: 1, paddingLeft: 8 }}>
                                <div style={{ fontWeight: 700 }}>
                                  {displayName}
                                </div>
                                {metaParts.length > 0 && (
                                  <div style={{ color: "var(--muted)" }}>
                                    {metaParts.join(" • ")}
                                  </div>
                                )}
                              </div>

                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  className="btn-outline"
                                  onClick={() => openItem(it)}
                                >
                                  Open File
                                </button>
                                <button
                                  className="btn-reset"
                                  onClick={() => handleRemove(it)}
                                >
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
