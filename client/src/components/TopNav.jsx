// client/src/components/TopNav.jsx
// App sidebar (kept the TopNav name so every page picks it up unchanged).
// Pages can pass extra sidebar content as children (e.g. the folder list).
// No accounts: the bottom shows the optional display name (set in Settings).
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon";
import AppLogo from "./AppLogo";
import { useDisplayName } from "../displayName";
import { requestTour } from "./Tour";
import "./TopNav.css";

const NAV_ITEMS = [
  { path: "/search", label: "Search", icon: "search", tour: "nav-search" },
  { path: "/saved", label: "Saved", icon: "star", tour: "nav-saved" },
  { path: "/history", label: "History", icon: "clock", tour: "nav-history" },
  { path: "/profile", label: "Settings", icon: "settings", tour: "nav-settings" },
];

export default function TopNav({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const name = useDisplayName();

  return (
    <nav className="sb-sidebar" aria-label="Main">
      <div className="sb-brand">
        <AppLogo size={34} className="sb-brand-logo" />
        <span className="sb-brand-name">SmartShot</span>
        <button
          type="button"
          className="sb-help"
          data-tour="help"
          aria-label="Take the tour"
          title="Take the tour"
          onClick={() => {
            if (location.pathname.startsWith("/search")) requestTour();
            else navigate("/search", { state: { tour: Date.now() } });
          }}
        >
          ?
        </button>
      </div>

      <div className="sb-nav">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              type="button"
              className={`sb-nav-item ${active ? "is-active" : ""}`}
              data-tour={item.tour}
              aria-current={active ? "page" : undefined}
              onClick={() => navigate(item.path)}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {children ? <div className="sb-extra">{children}</div> : <div className="sb-spacer" />}

      <button
        type="button"
        className="sb-account"
        onClick={() => navigate("/profile")}
        title={name ? "Change your name in Settings" : "Add your name (optional)"}
      >
        <span className="sb-avatar" aria-hidden="true">
          {name ? name.charAt(0).toUpperCase() : <Icon name="user" size={16} />}
        </span>
        <span className="sb-account-text">
          <span className="sb-account-name">{name || "Add your name"}</span>
          <span className="sb-account-sub">{name ? "On this computer" : "Optional"}</span>
        </span>
        <Icon name="edit" size={15} className="sb-account-edit" />
      </button>
    </nav>
  );
}
