// client/src/components/InfoTip.jsx
// Small round "i" (or "!") icon. Hover, focus or click it to read the message.
// The popup is rendered on top of everything (portal + fixed position) and is
// kept inside the window, so sidebars and panels can never cut it off.
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./InfoTip.css";

const GAP = 10;
const MARGIN = 12;
const MAX_WIDTH = 280;

export default function InfoTip({ text, variant = "info", label = "More info" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const id = useId();

  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(MAX_WIDTH, vw - MARGIN * 2);
    const popH = popRef.current ? popRef.current.offsetHeight : 90;
    const center = r.left + r.width / 2;
    const left = Math.max(MARGIN, Math.min(center - 24, vw - width - MARGIN));
    const below = r.bottom + GAP + popH <= vh - MARGIN;
    const top = below ? r.bottom + GAP : Math.max(MARGIN, r.top - GAP - popH);
    setPos({ top, left, width, arrow: Math.max(12, Math.min(center - left, width - 12)), below });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Re-measure once the popup has rendered and its height is known.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, place, text]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  if (!text) return null;

  return (
    <span
      className={`infotip infotip-${variant}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={btnRef}
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
      {open
        ? createPortal(
            <span
              ref={popRef}
              id={id}
              role="tooltip"
              className={`infotip-pop ${pos && !pos.below ? "is-above" : ""}`}
              style={{
                top: pos ? pos.top : -9999,
                left: pos ? pos.left : -9999,
                maxWidth: pos ? pos.width : MAX_WIDTH,
                "--arrow-left": `${pos ? pos.arrow : 16}px`,
              }}
            >
              {text}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
