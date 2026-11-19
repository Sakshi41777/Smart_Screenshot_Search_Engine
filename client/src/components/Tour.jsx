// client/src/components/Tour.jsx
// A short guided tour for new users. Dims the screen, highlights one part of
// the app at a time and shows a small card explaining it.
//
// Each step: { target?: CSS selector (may match several elements), title, body }
// Steps without a target (or whose target is not on screen) show a centred card.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Tour.css";

const TOUR_DONE_KEY = "APP_TOUR_DONE";
const PAD = 8; // space around the highlighted element
const GAP = 14; // space between the highlight and the card
const EDGE = 12; // minimum distance from the window edge

export function wasTourDone() {
  try {
    return localStorage.getItem(TOUR_DONE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTourDone() {
  try {
    localStorage.setItem(TOUR_DONE_KEY, "1");
  } catch {
    /* storage unavailable: the tour simply shows again next time */
  }
}

// Ask the search page to start the tour (used by the "?" button).
export function requestTour() {
  window.dispatchEvent(new CustomEvent("app:start-tour"));
}

function getTargetRect(selector) {
  if (!selector) return null;
  let nodes = [];
  try {
    nodes = Array.from(document.querySelectorAll(selector));
  } catch {
    return null;
  }
  const rects = nodes
    .map((n) => n.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return null;
  const top = Math.min(...rects.map((r) => r.top));
  const left = Math.min(...rects.map((r) => r.left));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const right = Math.max(...rects.map((r) => r.right));
  return { top, left, width: right - left, height: bottom - top, bottom, right };
}

function placeCard(rect, cardW, cardH) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x) => Math.max(EDGE, Math.min(x, vw - cardW - EDGE));
  const clampY = (y) => Math.max(EDGE, Math.min(y, vh - cardH - EDGE));

  if (!rect) {
    return { top: clampY((vh - cardH) / 2), left: clampX((vw - cardW) / 2), side: "center" };
  }

  const box = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    right: rect.right + PAD,
    bottom: rect.bottom + PAD,
  };

  // Right of the target (sidebar items), then below, above, left.
  if (vw - box.right >= cardW + GAP + EDGE && rect.height < vh * 0.6) {
    return { top: clampY(box.top + (box.bottom - box.top) / 2 - cardH / 2), left: box.right + GAP, side: "right" };
  }
  if (vh - box.bottom >= cardH + GAP + EDGE) {
    return { top: box.bottom + GAP, left: clampX(box.left), side: "bottom" };
  }
  if (box.top >= cardH + GAP + EDGE) {
    return { top: box.top - GAP - cardH, left: clampX(box.left), side: "top" };
  }
  if (box.left >= cardW + GAP + EDGE) {
    return { top: clampY(box.top), left: box.left - GAP - cardW, side: "left" };
  }
  // Large target: float the card inside it, near the bottom.
  return { top: clampY(box.bottom - cardH - 24), left: clampX(box.left + 24), side: "inside" };
}

export default function Tour({ open, steps, onClose }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999, side: "center" });
  const cardRef = useRef(null);
  const step = steps[index] || null;
  const isLast = index === steps.length - 1;

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const finish = useCallback(() => {
    markTourDone();
    onClose?.();
  }, [onClose]);

  // Bring the target into view when the step changes.
  useEffect(() => {
    if (!open || !step?.target) return;
    try {
      const el = document.querySelector(step.target);
      if (el?.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      /* ignore bad selectors */
    }
  }, [open, step]);

  // Track the target's position (it can move while the page lays out or scrolls).
  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    let last = "";
    const measure = () => {
      const r = getTargetRect(step?.target);
      const sig = r ? `${r.top}|${r.left}|${r.width}|${r.height}` : "none";
      if (sig !== last) {
        last = sig;
        setRect(r);
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [open, step]);

  useLayoutEffect(() => {
    if (!open || !cardRef.current) return;
    const { offsetWidth, offsetHeight } = cardRef.current;
    setPos(placeCard(rect, offsetWidth, offsetHeight));
  }, [open, rect, index]);

  useEffect(() => {
    if (open) cardRef.current?.focus({ preventScroll: true });
  }, [open, index]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (isLast) finish();
        else setIndex((i) => i + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isLast, finish]);

  if (!open || !step) return null;

  const spot = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  return createPortal(
    <div className="tour-root" role="presentation">
      {/* Blocks clicks on the app while the tour is open. */}
      <div className={`tour-backdrop ${spot ? "" : "is-dim"}`} onClick={(e) => e.stopPropagation()} />
      {spot ? (
        <div className="tour-spot" style={spot} aria-hidden="true">
          <span className="tour-spot-ring" />
        </div>
      ) : null}

      <div
        ref={cardRef}
        className={`tour-card side-${pos.side}`}
        style={{ top: pos.top, left: pos.left }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        key={index}
      >
        <div className="tour-top">
          <span className="tour-count">
            {index + 1} of {steps.length}
          </span>
          {!isLast ? (
            <button type="button" className="tour-skip" onClick={finish}>
              Skip tour
            </button>
          ) : null}
        </div>
        {step.badge ? <span className="tour-badge" aria-hidden="true">{step.badge}</span> : null}
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>

        <div className="tour-foot">
          <div className="tour-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id || i} className={i === index ? "is-on" : i < index ? "is-past" : ""} />
            ))}
          </div>
          <div className="tour-actions">
            {index > 0 ? (
              <button type="button" className="tour-btn tour-btn-ghost" onClick={() => setIndex((i) => i - 1)}>
                Back
              </button>
            ) : null}
            <button
              type="button"
              className="tour-btn tour-btn-primary"
              onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
            >
              {isLast ? step.doneLabel || "Got it" : index === 0 ? "Show me around" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
