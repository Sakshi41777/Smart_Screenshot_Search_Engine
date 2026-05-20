import React, { useEffect, useRef } from "react";
import "./Modal.css";

export default function Modal({ open, title, children, onClose, width = 720 }) {
  const shellRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") {
        if (typeof onClose === "function") onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    // prevent background scrolling while modal is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title || "Modal"}
      onMouseDown={(e) => {
        // click on backdrop closes
        if (e.target === e.currentTarget) {
          if (typeof onClose === "function") onClose();
        }
      }}
    >
      <div
        ref={shellRef}
        className="modal-shell"
        style={{ maxWidth: typeof width === "number" ? `${width}px` : width }}
        onMouseDown={(e) => {
          // prevent backdrop handler when clicking inside shell
          e.stopPropagation();
        }}
      >
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <div>
            <button className="btn-outline modal-close" onClick={onClose} aria-label="Close">Close</button>
          </div>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}
