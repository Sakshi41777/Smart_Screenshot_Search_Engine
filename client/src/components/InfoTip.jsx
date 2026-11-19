// client/src/components/InfoTip.jsx
// Small round "i" (or "!") icon. Hover, focus or click it to read the message.
import React, { useId, useState } from "react";
import "./InfoTip.css";

export default function InfoTip({ text, variant = "info", label = "More info", align = "left" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!text) return null;

  return (
    <span
      className={`infotip infotip-${variant}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="infotip-btn"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {variant === "warn" ? "!" : "i"}
      </button>
      {open ? (
        <span id={id} role="tooltip" className={`infotip-pop infotip-pop-${align}`}>
          {text}
        </span>
      ) : null}
    </span>
  );
}
