// client/src/displayName.js
// Optional name the user can set to personalise the app ("Welcome back, Sakshi").
// Stored only on this computer. Empty = no personalisation.
import { useEffect, useState } from "react";

const NAME_KEY = "APP_DISPLAY_NAME";
const ASKED_KEY = "APP_NAME_PROMPT_DONE";
const EVENT = "app:display-name";

export function getDisplayName() {
  try {
    return String(localStorage.getItem(NAME_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function setDisplayName(name) {
  const clean = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
  try {
    if (clean) localStorage.setItem(NAME_KEY, clean);
    else localStorage.removeItem(NAME_KEY);
    localStorage.setItem(ASKED_KEY, "1");
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: clean }));
  return clean;
}

export function wasNamePromptDone() {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return true;
  }
}

export function markNamePromptDone() {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: getDisplayName() }));
}

// React hook: current name, updates everywhere when it changes.
export function useDisplayName() {
  const [name, setName] = useState(getDisplayName);
  useEffect(() => {
    const onChange = () => setName(getDisplayName());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return name;
}
