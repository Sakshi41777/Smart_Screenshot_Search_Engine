// client/src/components/AppLogo.jsx
// Full-colour SmartShot logo (same artwork as the app icon).
import React from "react";

export default function AppLogo({ size = 34, className = "" }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 160 160"
      role="img"
      aria-label="SmartShot"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="160" height="160" rx="36" fill="#7a5133" />
      <rect x="30" y="32" width="88" height="70" rx="10" fill="#fdf6ee" />
      <rect x="42" y="46" width="48" height="7" rx="3.5" fill="#d9c2a3" />
      <rect x="42" y="60" width="62" height="7" rx="3.5" fill="#d9c2a3" />
      <rect x="42" y="74" width="36" height="7" rx="3.5" fill="#d9c2a3" />
      <circle cx="103" cy="100" r="26" fill="#7a5133" stroke="#f0b35a" strokeWidth="9" />
      <circle cx="103" cy="100" r="12" fill="#fdf6ee" opacity="0.25" />
      <path d="M122 119 L139 136" stroke="#f0b35a" strokeWidth="11" strokeLinecap="round" />
    </svg>
  );
}
