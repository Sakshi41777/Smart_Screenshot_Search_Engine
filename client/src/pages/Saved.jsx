import React, { memo, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import TopNav from "../components/TopNav";
import Icon from "../components/Icon";
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
  <rect width="320" height="200" rx="14" fill="#f4e4d8"/>
  <rect x="18" y="18" width="284" height="164" rx="12" fill="#dfd2c4"/>
  <rect x="30" y="56" width="72" height="88" rx="10" fill="#91643e"/>
  <text x="66" y="106" text-anchor="middle" fill="#fff" font-size="21" font-family="Segoe UI, Arial" font-weight="700">${safeLabel}</text>
  <text x="122" y="84" fill="#1f150d" font-size="22" font-family="Segoe UI, Arial" font-weight="700">Document Preview</text>
  <text x="122" y="112" fill="#896e54" font-size="13" font-family="Segoe UI, Arial">Open folder to view original file.</text>
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

  async function openFile(it) {
    if (!it?.path) return;
    if (window.electronAPI?.openPath) {
      try {
        const result = await window.electronAPI.openPath(it.path);
        if (!result) return;
      } catch (e) {
        console.error("Could not open file", e);
      }
    }
    openItem(it);
  }

  function parentFolder(path = "") {
    const parts = String(path || "").split(/[\\/]/).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 2] : "";
  }

  return (
    <div className="sp-root">
      <TopNav user={user} onSignOut={onSignOut} />

      <main className="pg-main">
        <header className="pg-head">
          <div>
            <h1>Saved</h1>
            <p>Files you starred while searching. Open them or show them in their folder.</p>
          </div>
          {!isGuest && !loading && !error && items.length > 0 ? (
            <div className="pg-head-actions">
              <button type="button" className="sx-ghost-btn" onClick={toggleSelectAll}>
                {selectedIds.size === items.length ? "Clear selection" : "Select all"}
              </button>
              {selectedIds.size > 0 ? (
                <button type="button" className="sx-ghost-btn" onClick={removeSelected}>
                  <Icon name="trash" size={15} />
                  Remove {selectedIds.size}
                </button>
              ) : null}
              <button type="button" className="pg-danger-btn" onClick={clearAllSaved}>
                Remove all
              </button>
            </div>
          ) : null}
        </header>

        {isGuest ? (
          <div className="sx-empty">
            <span className="sx-empty-icon"><Icon name="star" size={26} /></span>
            <h2>Sign in to save files</h2>
            <p>Guests can search, but saved files are kept only for signed-in accounts.</p>
            <button type="button" className="sx-primary-btn" onClick={handleSignIn}>Sign in</button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="pg-loading">Loading your saved files…</div>
        ) : error ? (
          <div className="sp-alert" role="alert">
            <span className="sp-alert-icon" aria-hidden="true">!</span>
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="sx-empty">
            <span className="sx-empty-icon"><Icon name="star" size={26} /></span>
            <h2>Nothing saved yet</h2>
            <p>Open a result in Search and press Save to keep it here.</p>
            <button type="button" className="sx-primary-btn" onClick={() => navigate("/search")}>
              <Icon name="search" size={16} />
              Go to search
            </button>
          </div>
        ) : (
          <div className="sx-grid">
            {items.map((it, idx) => {
              const id = getItemId(it, idx);
              const displayName = it.name || (it.path ? it.path.split(/[\\/]/).pop() : "Saved item");
              const folder = parentFolder(it.path);
              const checked = selectedIds.has(id);
              return (
                <div key={id} className={`sx-card sv-card ${checked ? "is-selected" : ""}`}>
                  <div className="sx-thumb" onDoubleClick={() => openFile(it)}>
                    <SavedThumbnail item={it} alt="" />
                    <label className="sv-check" title="Select">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(id)}
                        aria-label={`Select ${displayName}`}
                      />
                    </label>
                  </div>
                  <div className="sx-card-body">
                    <div className="sx-card-name" title={displayName}>{displayName}</div>
                    <div className="sx-card-meta">
                      {[folder, it.size].filter(Boolean).join(" · ") || (it.type || "File")}
                    </div>
                    <div className="sv-actions">
                      <button type="button" className="sx-icon-text" onClick={() => openFile(it)}>
                        <Icon name="open" size={14} />
                        Open
                      </button>
                      <button type="button" className="sx-icon-text" onClick={() => openItem(it)}>
                        <Icon name="folder" size={14} />
                        Show in folder
                      </button>
                      <button
                        type="button"
                        className="sb-icon-btn sv-remove"
                        aria-label={`Remove ${displayName}`}
                        title="Remove"
                        onClick={() => handleRemove(it)}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
