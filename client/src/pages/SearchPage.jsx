import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactCrop from "react-image-crop";
import { useLocation } from "react-router-dom";
import api from "../api";
import TopNav from "../components/TopNav";
import Modal from "../components/Modal";
import "./SearchPage.css";
import "react-image-crop/dist/ReactCrop.css";
import { similarity } from "../search/fuzzy";


function getFileExt(file) {
  return (file?.path?.split(".").pop() || "").toLowerCase();
}

function isSupportedImagePath(filePath = "") {
  const ext = String(filePath || "")
    .split(".")
    .pop()
    .toLowerCase();
  return ["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext);
}

function isPreviewableImage(file) {
  const ext = getFileExt(file);
  const type = (file?.type || "").toLowerCase();
  const imageExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
  if (imageExts.includes(ext)) return true;
  // Some records may be mis-typed as image without a clear extension.
  return type === "image" && !ext;
}

function svgDataUri(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getDocumentIcon(file, large = false) {
  const ext = getFileExt(file);
  const label = ext === "pdf" ? "PDF" : ext ? ext.toUpperCase() : "DOC";
  const size = large ? 560 : 320;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(
    size * 0.62
  )}" viewBox="0 0 ${size} ${Math.round(size * 0.62)}">
  <rect x="0" y="0" width="${size}" height="${Math.round(
    size * 0.62
  )}" rx="20" fill="#f8fafc"/>
  <rect x="18" y="18" width="${size - 36}" height="${Math.round(
    size * 0.62 - 36
  )}" rx="16" fill="#e2e8f0" stroke="#cbd5e1"/>
  <rect x="${Math.round(size * 0.12)}" y="${Math.round(
    size * 0.19
  )}" width="${Math.round(size * 0.2)}" height="${Math.round(
    size * 0.24
  )}" rx="10" fill="${ext === "pdf" ? "#dc2626" : "#2563eb"}"/>
  <text x="${Math.round(size * 0.22)}" y="${Math.round(
    size * 0.34
  )}" text-anchor="middle" fill="#fff" font-size="${Math.round(
    size * 0.045
  )}" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${label}</text>
  <text x="${Math.round(size * 0.38)}" y="${Math.round(
    size * 0.28
  )}" fill="#0f172a" font-size="${Math.round(
    size * 0.05
  )}" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Document Preview</text>
  <text x="${Math.round(size * 0.38)}" y="${Math.round(
    size * 0.36
  )}" fill="#475569" font-size="${Math.round(
    size * 0.032
  )}" font-family="Segoe UI, Arial, sans-serif">Open file location to view original file.</text>
</svg>`;
  return svgDataUri(svg);
}

function tokenize(text = "") {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function isDuplicateIntentQuery(raw = "") {
  return /\b(duplicate|duplicates|identical|same|copy|copies|clone|clones)\b/i.test(
    String(raw || "")
  );
}

function toDayStart(rawDate) {
  if (!rawDate) return null;
  return new Date(`${rawDate}T00:00:00`);
}

function toDayEnd(rawDate) {
  if (!rawDate) return null;
  return new Date(`${rawDate}T23:59:59.999`);
}

function getDescriptionSnippet(file) {
  return getMeaningfulDescription(file, { short: true });
}

function getMeaningfulDescription(file, { short = false } = {}) {
  const raw = String(file?.extractText || "");
  const cleaned = cleanOcrText(raw);
  if (!cleaned) {
    return short
      ? "No clear text found."
      : "No clear text found in this file. Try opening the original file.";
  }

  if (!short) return cleaned;

  const firstSentence = cleaned.split(/(?<=[.!?])\s+/).find(Boolean) || cleaned;
  if (firstSentence.length <= 140) return firstSentence;
  return `${firstSentence.slice(0, 140).trim()}...`;
}

function cleanOcrText(input) {
  if (!input) return "";
  const lines = input
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const useful = [];
  const seen = new Set();

  function looksLikeNoise(line) {
    if (!line) return true;
    const compact = line.replace(/\s+/g, " ").trim();
    if (!compact) return true;
    if (compact.length < 4) return true;

    const alphaNum = (compact.match(/[a-zA-Z0-9]/g) || []).length;
    const letters = (compact.match(/[a-zA-Z]/g) || []).length;
    const noiseChars = (compact.match(/[^a-zA-Z0-9\s.,:%$@#&()\-\/]/g) || []).length;
    const looksLikeGarbage = /(.)\1{5,}/.test(compact);
    const mostlySymbols = alphaNum > 0 ? noiseChars > alphaNum * 0.45 : true;
    const tooFewLetters = letters < 2;
    const hashy = /^[\W_]+$/.test(compact);
    const tokenCount = compact.split(/\s+/).length;
    const longSingleToken = tokenCount === 1 && compact.length > 28;

    return looksLikeGarbage || mostlySymbols || tooFewLetters || hashy || longSingleToken;
  }

  function normalizeLine(line) {
    return line
      .replace(/\s+/g, " ")
      .replace(/[|`~^]/g, "")
      .trim();
  }

  for (const line of lines) {
    const compact = normalizeLine(line);
    if (looksLikeNoise(compact)) continue;

    const key = compact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    useful.push(compact);
  }

  if (!useful.length) return "";

  const joined = useful.join(". ").replace(/\s+/g, " ").trim();
  const sentenceCandidates = joined
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);

  const scored = sentenceCandidates
    .map((sentence) => {
      const words = sentence.split(/\s+/).filter(Boolean);
      const wordCount = words.length;
      const hasVerbish = /\b(is|are|was|were|has|have|can|will|should|contains|shows|includes)\b/i.test(sentence);
      const hasContext = /\b(name|date|time|question|answer|document|invoice|receipt|interview|report|project|code|error)\b/i.test(sentence);
      let score = 0;
      if (wordCount >= 5 && wordCount <= 24) score += 2;
      if (hasVerbish) score += 1;
      if (hasContext) score += 1;
      if (/[:;]/.test(sentence)) score += 0.5;
      if (/^\d+$/.test(sentence)) score -= 2;
      if (/^[^a-zA-Z]*$/.test(sentence)) score -= 2;
      return { sentence, score };
    })
    .sort((a, b) => b.score - a.score);

  const selected = [];
  for (const item of scored) {
    if (item.score < 0.5) continue;
    selected.push(item.sentence);
    if (selected.join(" ").length >= 380) break;
    if (selected.length >= 4) break;
  }

  const finalText = (selected.length ? selected : useful.slice(0, 3))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return finalText.length > 420 ? `${finalText.slice(0, 420).trim()}...` : finalText;
}

function isContextualAssistantQuery(raw = "") {
  const q = String(raw || "").toLowerCase().trim();
  if (!q) return false;
  const asksSummary = /\b(summarize|summarise|summary|summirize|explain|describe|what is this|tell me about)\b/i.test(q);
  const hasContextRef = /\b(this|it|that|selected|document|file)\b/i.test(q);
  return asksSummary && hasContextRef;
}

function buildCopyText(file) {
  const name = String(file?.name || "Untitled").trim();
  const type = String(file?.type || "").trim() || "unknown";
  const pathValue = String(file?.path || "").trim();
  const rawText = String(file?.extractText || file?.extractedText || "");
  const cleaned = cleanOcrText(rawText);

  if (cleaned) return cleaned;

  const lines = [
    `File: ${name}`,
    `File type: ${type}`,
    pathValue ? `File location: ${pathValue}` : "",
    "Text could not be read from this file.",
  ].filter(Boolean);

  return lines.join("\n");
}

function collectTopKeywords(files = [], limit = 5) {
  const stop = new Set([
    "this",
    "that",
    "with",
    "from",
    "have",
    "your",
    "file",
    "files",
    "image",
    "images",
    "document",
    "documents",
    "screenshot",
    "screenshots",
    "about",
    "show",
    "find",
    "what",
    "when",
    "where",
    "which",
    "then",
    "into",
    "inside",
    "there",
    "here",
  ]);

  const score = new Map();
  files.slice(0, 80).forEach((f) => {
    const source = `${f?.name || ""} ${f?.extractText || f?.extractedText || ""}`
      .toLowerCase()
      .replace(/[_\-./\\]/g, " ");
    source
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 4 && /^[a-z0-9]+$/.test(t) && !stop.has(t))
      .forEach((t) => score.set(t, (score.get(t) || 0) + 1));
  });

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

export default function SearchPage({ user, onSignOut }) {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("choose");
  const [extFilter, setExtFilter] = useState("all");
  const [sortBy, setSortBy] = useState("relevance");
  const [sizeMin, setSizeMin] = useState("");
  const [sizeMax, setSizeMax] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // resolve backend base from electron if available
  const [backendUrl, setBackendUrl] = useState(
    (typeof window !== "undefined" && window.BACKEND_BASE_URL) ||
      "http://127.0.0.1:5001"
  );
  useEffect(() => {
    if (window?.electronAPI?.getBackendUrl) {
      window.electronAPI.getBackendUrl().then((url) => {
        if (url) setBackendUrl(url);
      });
    }
  }, []);

  // helpers that build thumbnail URLs using the dynamic backend base
  function getImageSrc(file) {
    if (!isPreviewableImage(file)) return getDocumentIcon(file);
    if (!file?.path) return getDocumentIcon(file);
    const base = backendUrl || "http://127.0.0.1:5001";
    return `${base.replace(/\/+$/, "")}/api/thumbnail?path=${encodeURIComponent(
      file.path
    )}`;
  }

  function getFullImageSrc(file) {
    if (!isPreviewableImage(file)) return getDocumentIcon(file, true);
    if (!file?.path) return getDocumentIcon(file, true);
    const base = backendUrl || "http://127.0.0.1:5001";
    return `${base.replace(/\/+$/, "")}/api/thumbnail?path=${encodeURIComponent(
      file.path
    )}&raw=1`;
  }

  const [top5, setTop5] = useState([]);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stats, setStats] = useState({ count: 0 });
  const [resultLimit, setResultLimit] = useState(20);
  const [showAllResults, setShowAllResults] = useState(false);
  const [showOcrText, setShowOcrText] = useState(true);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [shareMenuBusy, setShareMenuBusy] = useState(false);
  const [shareMenuPublicLink, setShareMenuPublicLink] = useState("");
  const [shareMenuStatus, setShareMenuStatus] = useState("");
  const [showInspect, setShowInspect] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [previousOcrByPath, setPreviousOcrByPath] = useState({});
  const [imageSearchLabel, setImageSearchLabel] = useState("");
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraError, setCameraError] = useState("");
  const [captureUrl, setCaptureUrl] = useState("");
  const [captureLabel, setCaptureLabel] = useState("");
  const [captureSource, setCaptureSource] = useState("");
  const [matchQueryUrl, setMatchQueryUrl] = useState("");
  const [matchQueryLabel, setMatchQueryLabel] = useState("");
  const [pendingImageFile, setPendingImageFile] = useState(null);
  const [crop, setCrop] = useState({
    unit: "%",
    x: 10,
    y: 10,
    width: 80,
    height: 80,
  });
  const [aspect, setAspect] = useState(4 / 3);
  const [aspectPreset, setAspectPreset] = useState("4:3");
  const [customAspectW, setCustomAspectW] = useState("4");
  const [customAspectH, setCustomAspectH] = useState("3");
  const [completedCrop, setCompletedCrop] = useState(null);

  const [selectedFolders, setSelectedFolders] = useState([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexReady, setIndexReady] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState("No folder selected.");
  const [indexEtaText, setIndexEtaText] = useState("");
  const [folderTimingHint, setFolderTimingHint] = useState("");
  const [indexError, setIndexError] = useState("");
  const [pendingSearchAfterIndex, setPendingSearchAfterIndex] = useState(false);
  const [showRequiredHints, setShowRequiredHints] = useState(false);

  const [loading, setLoading] = useState(false);
  const [pendingAutoRun, setPendingAutoRun] = useState(null);
  const sseRef = useRef(null);
  const isIndexingRef = useRef(isIndexing);
  const indexReadyRef = useRef(indexReady);
  const bgConsentPromptedRef = useRef(false);
  const handledRouteStateRef = useRef("");
  const galleryInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cropImageRef = useRef(null);
  const sharePublicLinkCacheRef = useRef({});

  const canSearch = indexReady && !isIndexing;
  const hasQuery = Boolean(query.trim());
  const isTypeChosen = String(typeFilter || "").toLowerCase() !== "choose";
  const selectedPath = String(selected?.path || "");
  const selectedText = String(selected?.extractText || selected?.extractedText || "");
  const previousSelectedText = selectedPath ? String(previousOcrByPath[selectedPath] || "") : "";
  const canRestorePreviousText =
    Boolean(selectedPath) &&
    Boolean(previousSelectedText) &&
    selectedText !== previousSelectedText;
  const selectedHasAnyText = Boolean(selectedText.trim());
  const ocrButtonLabel = canRestorePreviousText
    ? "Use Previous Text"
    : !selectedHasAnyText
      ? "Get Text"
      : "Refresh Text";

  const querySuggestionChips = useMemo(() => {
    const folderName =
      selectedFolders.length > 0
        ? getFolderDisplayName(selectedFolders[selectedFolders.length - 1])
        : "";
    const pool = results.length ? results : top5;
    const topKeywords = collectTopKeywords(pool, 5);
    const selectedName = String(selected?.name || "").trim();
    const imageLabel = String(imageSearchLabel || "").trim();

    const suggestions = [];
    const selectedType = String(typeFilter || "").toLowerCase();
    const wantsDocuments = selectedType === "document";
    const wantsImages = selectedType === "image";

    if (folderName) {
      suggestions.push(`show recent files in ${folderName}`);
    }
    if (selectedName) {
      suggestions.push(`summarize ${selectedName}`);
    }
    if (imageLabel) {
      suggestions.push(`find similar images to ${imageLabel}`);
    }

    topKeywords.slice(0, 3).forEach((kw) => {
      if (wantsDocuments) {
        suggestions.push(`find documents about ${kw}`);
      } else if (wantsImages) {
        suggestions.push(`find images about ${kw}`);
      } else {
        suggestions.push(`find files about ${kw}`);
      }
    });

    if (wantsDocuments) {
      suggestions.push("summarize document content");
      suggestions.push("find report or notes files");
    } else if (wantsImages) {
      suggestions.push("find duplicate screenshots");
      suggestions.push("find similar ui screenshots");
    } else {
      suggestions.push("find related files in this folder");
    }

    suggestions.push("find files containing specific text");
    suggestions.push("show text-heavy documents");
    suggestions.push("find files without readable text");
    suggestions.push("show visual-only images");

    if (!suggestions.length) {
      suggestions.push(
        "find duplicate screenshots",
        "find login error screenshots",
        "summarize interview notes document",
        "show files related to this folder"
      );
    }

    return Array.from(new Set(suggestions)).slice(0, 7);
  }, [selectedFolders, selected, imageSearchLabel, results, top5, typeFilter]);

  const chatSuggestionChips = useMemo(() => {
    const selectedName = String(selected?.name || "this file").trim();
    const ocrText = String(selected?.extractText || selected?.extractedText || "").trim();
    const hasText = Boolean(ocrText);
    const base = [
      `Summarize ${selectedName}`,
      "Extract key points",
      "What is this about?",
      "Give action items",
    ];
    if (hasText) {
      base.push("Rewrite this in simple language");
      base.push("What are the important dates/numbers?");
    } else {
      base.push("Extract readable text from this file");
      base.push("Describe visible content in this image");
      base.push("What can be inferred from this file?");
    }
    return base.slice(0, 6);
  }, [selected]);

  useEffect(() => {
    isIndexingRef.current = isIndexing;
  }, [isIndexing]);

  useEffect(() => {
    indexReadyRef.current = indexReady;
  }, [indexReady]);

  useEffect(() => {
    if (bgConsentPromptedRef.current) return;
    if (!window.electronAPI?.getBackgroundIndexSettings) return;
    bgConsentPromptedRef.current = true;

    let mounted = true;
    (async () => {
      try {
        const settings = await window.electronAPI.getBackgroundIndexSettings();
        if (!mounted || !settings || settings.consentGiven) return;

        const agreed = window.confirm(
          "Allow background indexing? This keeps search fast by silently indexing files in approved folders. You can change this anytime in Profile settings."
        );
        if (!agreed) return;

        let folders = Array.isArray(settings.folders) ? settings.folders : [];
        if (!folders.length && window.electronAPI?.getDefaultIndexFolders) {
          try {
            const defaults = await window.electronAPI.getDefaultIndexFolders();
            if (Array.isArray(defaults) && defaults.length) folders = defaults;
          } catch {}
        }

        await window.electronAPI.setBackgroundIndexSettings({
          consentGiven: true,
          enabled: true,
          strictPrivacy: false,
          keepRunningInTray: true,
          runAtStartup: true,
          useSpecificFolders: false,
          folders,
        });
        if (mounted) showActionMessage("Background indexing enabled.");
      } catch {}
    })();

    return () => {
      mounted = false;
    };
  }, []);

  function showActionMessage(msg) {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(""), 1800);
  }

  function applyQuerySuggestion(suggestion) {
    setQuery(String(suggestion || ""));
    if (showRequiredHints) setShowRequiredHints(false);
  }

  function applyChatSuggestion(suggestion) {
    setChatInput(String(suggestion || ""));
  }

  function normalizeFolderPaths(folders = []) {
    return (Array.isArray(folders) ? folders : [])
      .map((f) => String(f || "").trim())
      .filter(Boolean)
      .filter((f, idx, arr) => arr.indexOf(f) === idx);
  }

  function getParentFolderFromPath(rawPath = "") {
    const full = String(rawPath || "").trim();
    if (!full) return "";
    if (/^[a-zA-Z]:[\\/]*$/.test(full)) return full;
    if (/[\\/]$/.test(full)) return full.replace(/[\\/]+$/, "");
    const parts = full.split(/[\\/]/).filter(Boolean);
    if (!parts.length) return "";
    const leaf = parts[parts.length - 1] || "";
    // If last segment looks like a file (has dot extension), return parent.
    if (/\.[a-z0-9]{1,8}$/i.test(leaf)) {
      const idx = Math.max(full.lastIndexOf("\\"), full.lastIndexOf("/"));
      if (idx <= 0) return "";
      return full.slice(0, idx);
    }
    // Otherwise treat as folder path directly.
    return full;
  }

  function extractFolderHintFromQuery(raw = "") {
    const q = String(raw || "").trim();
    if (!q) return "";
    const m = q.match(
      /\b(?:show|list|find)?\s*(?:the\s+)?(?:recent|latest|newest)\s+(?:files|items)?\s*(?:in|from)\s+(.+)$/i
    );
    if (!m?.[1]) return "";
    return String(m[1] || "").trim().replace(/^["']|["']$/g, "");
  }

  async function resolveFolderForAutoRun(incomingPath = "", incomingQuery = "") {
    const fromPath = getParentFolderFromPath(incomingPath || "");
    if (fromPath) return fromPath;

    const hint = extractFolderHintFromQuery(incomingQuery || "");
    if (!hint) return "";

    if (window.electronAPI?.getDefaultIndexFolders) {
      try {
        const defaults = await window.electronAPI.getDefaultIndexFolders();
        const rows = normalizeFolderPaths(defaults);
        const hintLc = hint.toLowerCase();
        const exact = rows.find(
          (p) => getFolderDisplayName(p).toLowerCase() === hintLc
        );
        if (exact) return exact;
        const fuzzy = rows.find((p) =>
          getFolderDisplayName(p).toLowerCase().includes(hintLc)
        );
        if (fuzzy) return fuzzy;
      } catch {}
    }

    return "";
  }

  function getFolderDisplayName(folderPath = "") {
    const raw = String(folderPath || "").trim();
    if (!raw) return "Unknown folder";
    const normalized = raw.replace(/[\\/]+$/, "");
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
    // Drive root case like C:\ or D:\
    const driveMatch = raw.match(/^[a-zA-Z]:/);
    if (driveMatch) return `${driveMatch[0]} (Root)`;
    return raw;
  }

  async function handleSaveItem(file) {
    if (!file) return;

    const payload = {
      name: file.name || "Saved item",
      path: file.path || "",
      type: file.type || "image",
      size: file.sizeKB ? `${file.sizeKB} KB` : undefined,
      thumbnailUrl: getImageSrc(file),
      extractText: file.extractText || "",
      query,
    };

    const endpoints = ["/api/items/favorites", "/api/saved", "/api/items"];
    let lastErr = null;

    for (const endpoint of endpoints) {
      try {
        await api.post(endpoint, payload);
        showActionMessage("Saved successfully.");
        return;
      } catch (err) {
        const status = err?.response?.status;
        const alreadySaved =
          status === 409 &&
          (err?.response?.data?.alreadySaved ||
            /already saved/i.test(String(err?.response?.data?.message || "")));

        if (alreadySaved) {
          showActionMessage("Already saved.");
          return;
        }

        // Try next compatibility endpoint for 404/405 route mismatch only.
        if (status === 404 || status === 405) {
          lastErr = err;
          continue;
        }

        lastErr = err;
        break;
      }
    }

    console.error("Save failed", lastErr);
    showActionMessage("Save failed.");
  }

  async function handleCopyDescription(file) {
    if (!file) return;
    const textToCopy = buildCopyText(file);

    try {
      await copyTextToClipboard(textToCopy);
      showActionMessage("Description copied.");
    } catch {
      showActionMessage("Copy failed.");
    }
  }

  async function copyTextToClipboard(text) {
    if (window.electronAPI?.copyText) {
      const ok = await window.electronAPI.copyText(String(text || ""));
      if (ok) return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(text || ""));
      return;
    }
    const temp = document.createElement("textarea");
    temp.value = String(text || "");
    temp.setAttribute("readonly", "");
    temp.style.position = "fixed";
    temp.style.left = "-9999px";
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    document.body.removeChild(temp);
  }

  async function handleCopyPath(file) {
    const filePath = String(file?.path || "").trim();
    if (!filePath) {
      showActionMessage("File location not available.");
      return;
    }
    try {
      await copyTextToClipboard(filePath);
      showActionMessage("File location copied.");
    } catch {
      showActionMessage("Copy file location failed.");
    }
  }

  async function handleShareFile(file) {
    if (!file) return;

    const name = String(file?.name || "Untitled").trim();
    const filePath = String(file?.path || "").trim();
    const details = [
      `File: ${name}`,
      filePath ? `File location: ${filePath}` : "",
      query ? `Search words: ${query}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      if (navigator.share) {
        await navigator.share({
          title: name || "Search result",
          text: details,
        });
        showActionMessage("Shared.");
        return;
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
    }

    try {
      await copyTextToClipboard(details);
      showActionMessage("Share text copied.");
    } catch {
      showActionMessage("Share failed.");
    }
  }

  async function getPublicShareLink(file) {
    const filePath = String(file?.path || "").trim();
    if (!filePath) return { url: "", error: "File location missing." };
    const cached = sharePublicLinkCacheRef.current[filePath];
    if (cached) {
      return {
        url: String(cached.url || "").trim(),
        previewUrl: String(cached.previewUrl || "").trim(),
        documentUrl: String(cached.documentUrl || "").trim(),
        error: "",
      };
    }
    try {
      const res = await api.post("/api/search/share/public-link", {
        path: filePath,
        name: file?.name || "",
      });
      const url = String(res?.data?.url || "").trim();
      const previewUrl = String(res?.data?.previewUrl || "").trim();
      const documentUrl = String(res?.data?.documentUrl || "").trim();
      if (url) {
        sharePublicLinkCacheRef.current[filePath] = {
          url,
          previewUrl,
          documentUrl,
        };
        return { url, previewUrl, documentUrl, error: "" };
      }
    } catch (err) {
      const errMsg = String(
        err?.response?.data?.error ||
          err?.message ||
          "Public link unavailable."
      ).trim();
      return { url: "", error: errMsg };
    }
    return { url: "", previewUrl: "", documentUrl: "", error: "Public link unavailable." };
  }

  async function getSharePayload(file, { preferPublicLink = false, publicLinkOverride = "" } = {}) {
    const name = String(file?.name || "Untitled").trim();
    const filePath = String(file?.path || "").trim();
    let previewLink = "";
    let documentLink = String(publicLinkOverride || "").trim();
    if (preferPublicLink) {
      if (!documentLink) {
        const publicResult = await getPublicShareLink(file);
        documentLink = publicResult.documentUrl || publicResult.url || "";
        previewLink = publicResult.previewUrl || "";
      } else {
        const cached = sharePublicLinkCacheRef.current[filePath];
        if (cached) {
          previewLink = String(cached.previewUrl || "").trim();
        }
      }
    }
    if (!previewLink && isPreviewableImage(file)) {
      previewLink = getFullImageSrc(file);
    }
    const details = [
      `File: ${name}`,
      documentLink ? `Open file: ${documentLink}` : "",
      previewLink ? `Thumbnail: ${previewLink}` : "",
      filePath ? `File location: ${filePath}` : "",
      query ? `Search words: ${query}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { name, details, previewLink, documentLink, filePath };
  }

  async function openExternalUrl(url) {
    const target = String(url || "").trim();
    if (!target) return false;
    if (window.electronAPI?.openExternal) {
      const ok = await window.electronAPI.openExternal(target);
      if (ok) return true;
    }
    const w = window.open(target, "_blank", "noopener,noreferrer");
    return Boolean(w);
  }

  async function shareByEmail(file) {
    if (!file) return;
    showActionMessage("Preparing email...");
    const payload = await getSharePayload(file, {
      preferPublicLink: true,
      publicLinkOverride: shareMenuPublicLink,
    });
    const emailBody = payload.documentLink
      ? [
          `File: ${payload.name}`,
          payload.previewLink ? `Thumbnail: ${payload.previewLink}` : "",
          `Open file: ${payload.documentLink}`,
        ]
          .filter(Boolean)
          .join("\n")
      : payload.details;
    const subject = encodeURIComponent(`Shared from app: ${payload.name}`);
    const body = encodeURIComponent(emailBody);
    const ok = await openExternalUrl(`mailto:?subject=${subject}&body=${body}`);
    if (!ok) {
      showActionMessage("Email app unavailable.");
      return;
    }
    setShowShareMenu(false);
    showActionMessage("Opening email app...");
  }

  async function shareToWhatsApp(file) {
    if (!file) return;
    showActionMessage("Preparing WhatsApp share...");
    const payload = await getSharePayload(file, {
      preferPublicLink: true,
      publicLinkOverride: shareMenuPublicLink,
    });
    if (!payload.documentLink) {
      showActionMessage("Public link unavailable. Configure cloud sharing.");
      return;
    }
    const shareText = [
      payload.previewLink || "",
      payload.documentLink,
      payload.name,
    ]
      .filter(Boolean)
      .join("\n");
    const text = encodeURIComponent(shareText);
    const ok = await openExternalUrl(`https://wa.me/?text=${text}`);
    if (!ok) {
      showActionMessage("WhatsApp share unavailable.");
      return;
    }
    setShowShareMenu(false);
    showActionMessage("WhatsApp opened with public link.");
  }

  async function shareToMoreApps(file) {
    if (!file) return;
    showActionMessage("Preparing app share...");
    const payload = await getSharePayload(file, {
      preferPublicLink: true,
      publicLinkOverride: shareMenuPublicLink,
    });
    try {
      if (navigator.share) {
        const shareData = {
          title: payload.name || "Search result",
          text: payload.details,
        };
        if (payload.documentLink || payload.previewLink) {
          shareData.url = payload.documentLink || payload.previewLink;
        }
        await navigator.share(shareData);
        setShowShareMenu(false);
        showActionMessage("Shared.");
        return;
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
    }

    try {
      await copyTextToClipboard(payload.documentLink || payload.previewLink || payload.details);
      setShowShareMenu(false);
      showActionMessage(payload.documentLink || payload.previewLink ? "Public link copied." : "Copied. Paste in any app.");
    } catch {
      showActionMessage("Share failed.");
    }
  }

  async function openShareMenu(file) {
    if (!file) return;
    if (showShareMenu) {
      setShowShareMenu(false);
      return;
    }
    setShowShareMenu(true);
    setShareMenuPublicLink("");
    setShareMenuStatus("Preparing public link...");
    setShareMenuBusy(true);
    showActionMessage("Preparing public link...");
    try {
      const publicResult = await getPublicShareLink(file);
      if (publicResult.url) {
        setShareMenuPublicLink(publicResult.documentUrl || publicResult.url);
        setShareMenuStatus("Public link ready.");
        showActionMessage("Public link ready.");
      } else {
        const reason = String(publicResult.error || "Public link unavailable.").trim();
        setShareMenuStatus(reason);
        showActionMessage(reason);
      }
    } finally {
      setShareMenuBusy(false);
    }
  }

  async function handleReOcrSelected(file) {
    if (!file?.path) {
      showActionMessage("File location not available.");
      return;
    }

    const filePath = String(file.path);
    const currentText = String(file.extractText || file.extractedText || "");
    const previousText = String(previousOcrByPath[filePath] || "");

    if (previousText && currentText !== previousText) {
      const restoredText = previousText;
      setSelected((prev) =>
        prev && prev.path === filePath
          ? { ...prev, extractText: restoredText, extractedText: restoredText }
          : prev
      );
      setResults((prev) =>
        prev.map((item) =>
          item.path === filePath
            ? { ...item, extractText: restoredText, extractedText: restoredText }
            : item
        )
      );
      setTop5((prev) =>
        prev.map((item) =>
          item.path === filePath
            ? { ...item, extractText: restoredText, extractedText: restoredText }
            : item
        )
      );
      setPreviousOcrByPath((prev) => {
        const next = { ...prev };
        delete next[filePath];
        return next;
      });
      showActionMessage("Previous text restored.");
      return;
    }

    try {
      showActionMessage("Refreshing text...");
      const res = await api.post("/api/search/reocr", { path: filePath });
      const nextText = String(
        res?.data?.file?.extractedText ||
          res?.data?.file?.extractText ||
          ""
      );

      if (nextText === currentText) {
        if (!nextText.trim()) {
          showActionMessage("No readable text found in this image.");
        } else {
          showActionMessage("Text is unchanged.");
        }
        return;
      }

      if (currentText && nextText) {
        const applyNew = window.confirm(
          "New extracted text found.\n\nPress OK to replace current description.\nPress Cancel to keep previous description."
        );
        if (!applyNew) {
          showActionMessage("Kept previous description.");
          return;
        }
      }

      if (currentText && nextText) {
        setPreviousOcrByPath((prev) => ({ ...prev, [filePath]: currentText }));
      }

      setSelected((prev) =>
        prev && prev.path === filePath
          ? { ...prev, extractText: nextText, extractedText: nextText }
          : prev
      );
      setResults((prev) =>
        prev.map((item) =>
          item.path === filePath
            ? { ...item, extractText: nextText, extractedText: nextText }
            : item
        )
      );
      setTop5((prev) =>
        prev.map((item) =>
          item.path === filePath
            ? { ...item, extractText: nextText, extractedText: nextText }
            : item
        )
      );

      if ((nextText || "").trim()) {
        showActionMessage("Text updated.");
      } else {
        showActionMessage("No readable text found for this file.");
      }
    } catch (err) {
      const msg =
        err?.response?.data?.error || "Could not refresh text right now.";
      showActionMessage(msg);
    }
  }

  async function handleOpenOriginal(file) {
    if (!file?.path) {
      showActionMessage("File location not available.");
      return;
    }

    try {
      if (!window.electronAPI) {
        showActionMessage("Open folder works in the desktop app.");
        return;
      }

      if (window.electronAPI?.showItemInFolder) {
        const ok = await window.electronAPI.showItemInFolder(file.path);
        if (ok) {
          showActionMessage("Opened and highlighted in File Explorer.");
          return;
        }
      }

      if (window.electronAPI?.openPath) {
        const openResult = await window.electronAPI.openPath(file.path);
        if (!openResult) return; // Electron returns empty string on success
        showActionMessage(`Open failed: ${openResult}`);
        return;
      }

      showActionMessage("Open folder is unavailable.");
    } catch (err) {
      console.error("Open original failed", err);
      showActionMessage("Unable to open location.");
    }
  }

  async function handleDeleteFile(file) {
    if (!file?.path) {
      showActionMessage("File location not available.");
      return;
    }
    if (!window.electronAPI?.deleteFile) {
      showActionMessage("Remove copy works in the desktop app.");
      return;
    }
    const ok = window.confirm("Delete this duplicate permanently?");
    if (!ok) return;

    try {
      const result = await window.electronAPI.deleteFile(file.path);
      if (result) {
        showActionMessage("Extra copy removed.");
        setTop5((prev) => prev.filter((f) => f.path !== file.path));
        setStats((prev) => ({ count: Math.max(0, (prev?.count || 0) - 1) }));
        setSelected(null);
        if (showPreviewModal) setShowPreviewModal(false);
      } else {
        showActionMessage("Delete failed.");
      }
    } catch (err) {
      console.error("Delete file failed", err);
      showActionMessage("Delete failed.");
    }
  }

  function openLargePreview(file) {
    if (!file) return;
    setSelected(file);
    setPreviewZoom(1);
    setShowShareMenu(false);
    setShareMenuBusy(false);
    setShareMenuPublicLink("");
    setShareMenuStatus("");
    setShowInspect(false);
    setChatInput("");
    setChatMessages([]);
    setShowPreviewModal(true);
  }

  async function askAboutSelected() {
    const question = String(chatInput || "").trim();
    if (!selected || !question || chatLoading) return;

    const nextUserMsg = { role: "user", text: question };
    setChatMessages((prev) => [...prev, nextUserMsg]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await api.post("/api/search/ask", {
        question,
        file: {
          name: selected.name || "",
          path: selected.path || "",
          type: selected.type || "",
          extractedText: selected.extractText || selected.extractedText || "",
        },
      });
      const answer = String(res?.data?.answer || "").trim();
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: answer || "No response received." },
      ]);
    } catch (err) {
      const errText =
        err?.response?.data?.error ||
        "Sorry, we could not answer that right now.";
      setChatMessages((prev) => [...prev, { role: "assistant", text: errText }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function askAboutFileFromSearch(file, question) {
    if (!file?.path || !String(question || "").trim()) return false;

    setSelected(file);
    setShowPreviewModal(true);
    setChatLoading(true);
    setChatInput("");
    setChatMessages([{ role: "user", text: String(question).trim() }]);

    try {
      const res = await api.post("/api/search/ask", {
        question: String(question).trim(),
        file: {
          name: file.name || "",
          path: file.path || "",
          type: file.type || "",
          extractedText: file.extractText || file.extractedText || "",
        },
      });
      const answer = String(res?.data?.answer || "").trim();
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: answer || "No response received." },
      ]);
      return true;
    } catch (err) {
      const errText =
        err?.response?.data?.error ||
        "Sorry, we could not answer that right now.";
      setChatMessages((prev) => [...prev, { role: "assistant", text: errText }]);
      return false;
    } finally {
      setChatLoading(false);
    }
  }

  async function startCameraStream() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera not supported in this browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      setCameraStream(stream);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera error:", err);
      setCameraError("Unable to access camera.");
    }
  }

  function stopCameraStream() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
  }

  function openCameraModal() {
    setCameraError("");
    setCaptureUrl("");
    setCaptureLabel("");
    setCaptureSource("camera");
    setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
    setAspect(4 / 3);
    setAspectPreset("free");
    setCustomAspectW("4");
    setCustomAspectH("3");
    setCompletedCrop(null);
    setShowCameraModal(true);
  }

  function closeCameraModal() {
    setShowCameraModal(false);
    setCaptureUrl("");
    setCaptureLabel("");
    setCaptureSource("");
    setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
    setAspect(4 / 3);
    setAspectPreset("free");
    setCustomAspectW("4");
    setCustomAspectH("3");
    setCompletedCrop(null);
    setCameraError("");
    stopCameraStream();
  }

  function capturePhoto() {
    if (!cameraVideoRef.current) return;
    const video = cameraVideoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCaptureUrl(dataUrl);
    setCaptureLabel("Camera capture");
    stopCameraStream();
  }

  async function getCroppedImageBlob(imageEl, cropPixels) {
    if (!imageEl || !cropPixels) return null;
    const canvas = document.createElement("canvas");
    canvas.width = cropPixels.width;
    canvas.height = cropPixels.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      imageEl,
      cropPixels.x,
      cropPixels.y,
      cropPixels.width,
      cropPixels.height,
      0,
      0,
      cropPixels.width,
      cropPixels.height
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    });
  }

  async function loadImageFromPath(path) {
    if (!path) return null;
    const base = backendUrl || "http://127.0.0.1:5001";
    const url = `${base.replace(/\/+$/, "")}/api/thumbnail?path=${encodeURIComponent(
      path
    )}&raw=1`;
    return url;
  }

  async function handleGallerySelect() {
    // Prefer browser file input flow to avoid Windows/OneDrive path picker issues.
    if (galleryInputRef.current) {
      galleryInputRef.current.click();
      return;
    }

    try {
      if (window.electronAPI?.selectImage) {
        const path = await window.electronAPI.selectImage();
        if (path) {
          if (!isSupportedImagePath(path)) {
            showActionMessage("Select from Gallery supports image files only. Use Select Folder for documents.");
            return;
          }
          const imageUrl = await loadImageFromPath(path);
          setCaptureSource("gallery");
          setCaptureUrl(imageUrl);
          setCaptureLabel(path.split("\\").pop() || "Gallery image");
          setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
          setAspect(4 / 3);
          setAspectPreset("free");
          setCustomAspectW("4");
          setCustomAspectH("3");
          setCompletedCrop(null);
          setShowCameraModal(true);
          return;
        }
      }
    } catch (err) {
      console.error("Native image picker failed:", err);
    }

    // Fallback for browser mode or when native picker fails.
    galleryInputRef.current?.click();
  }

  function applyCustomAspect() {
    const w = Number(customAspectW);
    const h = Number(customAspectH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      showActionMessage("Enter a valid custom aspect ratio.");
      return;
    }
    setAspect(w / h);
    setAspectPreset("custom");
  }

  async function useCroppedImage() {
    if (!captureUrl || !cropImageRef.current) {
      showActionMessage("Capture and crop an image first.");
      return;
    }
    const fallbackFullCrop = {
      x: 0,
      y: 0,
      width: cropImageRef.current.naturalWidth || cropImageRef.current.width,
      height: cropImageRef.current.naturalHeight || cropImageRef.current.height,
    };
    const targetCrop =
      completedCrop && completedCrop.width > 1 && completedCrop.height > 1
        ? completedCrop
        : fallbackFullCrop;
    const blob = await getCroppedImageBlob(cropImageRef.current, targetCrop);
    if (!blob) {
      showActionMessage("Crop failed.");
      return;
    }
    if (matchQueryUrl && matchQueryUrl.startsWith("blob:")) {
      URL.revokeObjectURL(matchQueryUrl);
    }
    const previewUrl =
      captureSource === "gallery" && captureUrl.startsWith("http")
        ? captureUrl
        : URL.createObjectURL(blob);
    setMatchQueryUrl(previewUrl);
    setMatchQueryLabel(captureLabel || "Selected image");
    const filename =
      captureSource === "gallery"
        ? `gallery-crop-${Date.now()}.jpg`
        : `camera-${Date.now()}.jpg`;
    const file = new File([blob], filename, {
      type: "image/jpeg",
    });
    setPendingImageFile(file);
    setImageSearchLabel(file.name || "Image selected");
    showActionMessage("Image selected. Apply filters and click Search.");
    closeCameraModal();
  }

  async function stopIndexing({ silent = false } = {}) {
    try {
      await api.post("/api/search/cancel-index");
      setProgressMessage("Stopping...");
      if (!silent) showActionMessage("Stopping...");
    } catch (err) {
      console.error("Cancel indexing failed", err);
      if (!silent) showActionMessage("Could not stop right now.");
    }
  }

  async function changeFolder() {
    if (isIndexing) {
      await stopIndexing({ silent: true });
      setIndexReady(false);
      setIndexError("Setup stopped. Choose another folder.");
      return;
    }
    await pickFolderElectron();
  }

  useEffect(() => {
    if (!isIndexing) return;

    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    const es = new EventSource(`${backendUrl || "http://127.0.0.1:5001"}/api/search/progress`);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data || "{}");

        if (data.message) {
          setProgressMessage("Preparing files...");
          setProgressPercent((prev) => Math.max(prev, 8));
        }

        const m = data.message?.match(/(\d+)\s*\/\s*(\d+)/);
        if (m) {
          const done = Number(m[1]);
          const total = Number(m[2]);
          if (Number.isFinite(done) && Number.isFinite(total) && total > 0) {
            const pct = Math.round((done / total) * 100);
            setProgressPercent(Math.max(0, Math.min(100, pct)));

            const ratio = done / total;
            if (ratio >= 0.98) setIndexEtaText("Almost done.");
            else if (ratio >= 0.7) setIndexEtaText("Great progress.");
            else if (ratio >= 0.35) setIndexEtaText("Working on your files.");
            else setIndexEtaText("Getting files ready.");

            if (total <= 150) {
              setFolderTimingHint("Finishes soon.");
            } else if (total <= 1200) {
              setFolderTimingHint("Please wait.");
            } else {
              setFolderTimingHint("Still working.");
            }
          }
        }

        if (data.stage === "done") {
          setProgressPercent(100);
          setProgressMessage("Files ready. Start searching.");
          setIndexEtaText("Completed.");
          setFolderTimingHint("Ready.");
          setIndexReady(true);
          setIsIndexing(false);
          setIndexError("");
          es.close();
        } else if (data.stage === "canceling") {
          setProgressMessage("Stopping...");
        } else if (data.stage === "canceled") {
          setProgressMessage("Setup stopped.");
          setIndexEtaText("");
          setFolderTimingHint("");
          setIsIndexing(false);
          setIndexReady(false);
          setIndexError("Setup stopped. You can choose another folder.");
          es.close();
        }
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };

    es.onerror = () => {
      es.close();
      setIsIndexing(false);
      setIndexError("Progress disconnected. Please try again.");
      setProgressMessage("Setup interrupted.");
      setIndexEtaText("");
      setFolderTimingHint("");
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [isIndexing]);

  async function startFolderIndexing(folders = [], { silent = false } = {}) {
    const sanitizedFolders = normalizeFolderPaths(folders);
    if (!sanitizedFolders.length) {
      if (!silent) showActionMessage("No valid folder path selected.");
      return false;
    }
    setSelectedFolders(sanitizedFolders);
    setIndexReady(false);
    setIsIndexing(true);
    setProgressPercent(4);
    setProgressMessage("Preparing files...");
    setIndexEtaText("Getting files ready.");
    setFolderTimingHint("Please wait.");
    if (!silent) setIndexError("");

    try {
      await api.post("/api/search/index-folders", { folders: sanitizedFolders });
      return true;
    } catch (err) {
      console.error("Folder setup failed", err);
      if (Number(err?.response?.status) === 409) {
        setIsIndexing(true);
        setIndexReady(false);
        setIndexError("");
        setProgressMessage("Preparing files in background...");
        setIndexEtaText("Please wait.");
        setFolderTimingHint("Please wait.");
        return true;
      }
      setIsIndexing(false);
      setIndexReady(false);
      if (!silent) setIndexError("We could not prepare this folder.");
      setProgressMessage("Could not prepare files.");
      setIndexEtaText("");
      setFolderTimingHint("");
      return false;
    }
  }

  async function pickFolderElectron() {
    setIndexError("");

    if (!window.electronAPI?.selectFolder) {
      setIndexReady(false);
      setProgressMessage("Folder picker is unavailable.");
      setIndexError("Please use the desktop app to choose folders.");
      return;
    }

    const folders = await window.electronAPI.selectFolder();
    const sanitizedFolders = normalizeFolderPaths(folders);
    if (!sanitizedFolders.length) return;

    await startFolderIndexing(sanitizedFolders);
  }

  async function getAutoFoldersForIndexing(preferredFolders = []) {
    const normalizedPreferred = normalizeFolderPaths(preferredFolders);
    if (normalizedPreferred.length) return normalizedPreferred;
    if (selectedFolders.length) return selectedFolders;

    if (window.electronAPI?.getDefaultIndexFolders) {
      try {
        const folders = await window.electronAPI.getDefaultIndexFolders();
        if (Array.isArray(folders) && folders.length) return folders;
      } catch (err) {
        console.error("Default folder lookup failed:", err);
      }
    }

    return [];
  }

  async function ensureIndexedForSearch(preferredFolders = []) {
    if (indexReadyRef.current) return true;

    if (isIndexingRef.current) {
      setPendingSearchAfterIndex(true);
      return false;
    }

    const autoFolders = await getAutoFoldersForIndexing(preferredFolders);
    if (!autoFolders.length) {
      showActionMessage("Please choose a folder first.");
      return false;
    }

    const started = await startFolderIndexing(autoFolders, { silent: true });
    if (started) {
      setPendingSearchAfterIndex(true);
    }
    return false;
  }

  function normalizeFiles(files = []) {
    return files.map((f) => ({
      ...f,
      extractText: f.extractText || f.extractedText || "",
      sizeKB: Number(f.sizeKB || 0),
      type: (f.type || "image").toLowerCase(),
      createdAt: f.createdAt ? new Date(f.createdAt) : null,
      _ext: (f.path?.split(".").pop() || "").toLowerCase(),
      fileHash: f.fileHash || null,
      imageHash: f.imageHash || null,
    }));
  }

  function applyFiltersAndSort(files = [], effectiveQuery = "") {
    const from = toDayStart(dateFrom);
    const to = toDayEnd(dateTo);
    const queryTokens = tokenize(effectiveQuery);
    const selectedType = String(typeFilter || "all").toLowerCase().trim();

    return files
      .filter((f) => {
        const docType = String(f.type || "").toLowerCase().trim();
        if (selectedType !== "all" && selectedType !== "choose") {
          if (selectedType === "image" && docType !== "image") return false;
          if (selectedType === "document" && docType !== "document") return false;
        }
        if (extFilter !== "all" && f._ext !== extFilter) return false;
        if (sizeMin && f.sizeKB < Number(sizeMin)) return false;
        if (sizeMax && f.sizeKB > Number(sizeMax)) return false;
        if (from && f.createdAt && f.createdAt < from) return false;
        if (to && f.createdAt && f.createdAt > to) return false;
        return true;
      })
      .map((f) => {
        const hay = `${f.name || ""} ${f.extractText || ""}`.toLowerCase();
        const tokenHits = queryTokens.filter((t) => hay.includes(t)).length;
        const tokenScore = queryTokens.length > 0 ? tokenHits / queryTokens.length : 0;
        const fuzzyScore = effectiveQuery ? similarity(effectiveQuery, hay) : 0;
        const backendScore = Number(f.score || 0);
        const containsFullQuery =
          effectiveQuery && hay.includes(effectiveQuery.toLowerCase()) ? 1 : 0;

        return {
          ...f,
          _score: backendScore + tokenScore * 1.2 + fuzzyScore * 0.6 + containsFullQuery,
        };
      })
      .sort((a, b) => {
        if (sortBy === "newest") {
          return (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0);
        }
        if (sortBy === "oldest") {
          return (a.createdAt?.getTime?.() || 0) - (b.createdAt?.getTime?.() || 0);
        }
        if (sortBy === "size_desc") return (b.sizeKB || 0) - (a.sizeKB || 0);
        if (sortBy === "size_asc") return (a.sizeKB || 0) - (b.sizeKB || 0);
        return b._score - a._score;
      });
  }

  async function runSearch(options = {}) {
    const effectiveQuery = String(options.query ?? query ?? "").trim();
    const preferredPath = options.path || null;
    const selectedImage = pendingImageFile;
    const scopedFolders = normalizeFolderPaths(
      options.scopeFolders ?? selectedFolders
    );

    if (isContextualAssistantQuery(effectiveQuery)) {
      const target = selected || results?.[0] || null;
      if (!target) {
        showActionMessage("Open a result first, then ask your question.");
        return;
      }
      const ok = await askAboutFileFromSearch(target, effectiveQuery);
      if (ok) showActionMessage("Answer ready.");
      return;
    }

    if (!effectiveQuery) {
      setShowRequiredHints(true);
      showActionMessage("Please type what you want to find.");
      return;
    }
    if (!isTypeChosen) {
      setShowRequiredHints(true);
      showActionMessage("Please choose a file kind.");
      return;
    }
    setShowRequiredHints(false);

    if (!canSearch) {
      const ready = await ensureIndexedForSearch(scopedFolders);
      if (!ready) return;
    }

    setLoading(true);
    setSelected(null);
    setResults([]);

    try {
      let files = [];

      if (selectedImage) {
        const form = new FormData();
        form.append("image", selectedImage);
        if (scopedFolders.length) {
          form.append("scopeFolders", JSON.stringify(scopedFolders));
        }
        const res = await api.post("/api/search/image-match", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        files = Array.isArray(res?.data?.files) ? res.data.files : [];
      } else {
        const res = await api.post("/api/search", {
          query: effectiveQuery,
          scopeFolders: scopedFolders,
        });
        files = Array.isArray(res?.data?.files) ? res.data.files : [];
      }

      const normalized = normalizeFiles(files);
      const scored = applyFiltersAndSort(normalized, effectiveQuery);
      const annotated = annotateDuplicates(scored);

      setShowAllResults(false);
      const topImages = annotated.filter((f) => f.type === "image").slice(0, 5);
      setTop5(topImages.length ? topImages : annotated.slice(0, 5));
      setResults(annotated);
      setStats({ count: annotated.length });

      // Persist history for signed-in users only; do not block search on failure.
      if (user && user.guest !== true && effectiveQuery) {
        const historyPath =
          String(preferredPath || "").trim() ||
          String(scopedFolders?.[0] || "").trim();
        const historyPayload = {
          query: effectiveQuery,
          path: historyPath,
          folderPath: historyPath,
        };
        try {
          await api.post("/api/search/history", historyPayload);
        } catch {
          try {
            await api.post("/api/history", historyPayload);
          } catch (err) {
            console.warn("History save skipped:", err?.response?.status || err?.message);
          }
        }
      }

      if (preferredPath) {
        const match = annotated.find((f) => f.path === preferredPath);
        if (match) setSelected(match);
      }

    } catch (err) {
      console.error("Search failed", err);
      showActionMessage("Search could not be completed.");
    } finally {
      setPendingSearchAfterIndex(false);
      setLoading(false);
    }
  }

  function annotateDuplicates(list = []) {
    const counts = new Map();
    list.forEach((f) => {
      if (f.fileHash) counts.set(f.fileHash, (counts.get(f.fileHash) || 0) + 1);
    });
    return list.map((f) => ({
      ...f,
      _dupCount: f.fileHash ? counts.get(f.fileHash) || 0 : 0,
    }));
  }

  useEffect(() => {
    if (showCameraModal && captureSource === "camera" && !captureUrl) {
      startCameraStream();
    }
    if (!showCameraModal) {
      stopCameraStream();
    }
  }, [showCameraModal, captureUrl, captureSource]);

  useEffect(() => {
    return () => {
      if (matchQueryUrl) {
        URL.revokeObjectURL(matchQueryUrl);
      }
    };
  }, [matchQueryUrl]);

  useEffect(() => {
    if (cameraVideoRef.current && cameraStream) {
      cameraVideoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  useEffect(() => {
    const routeState = location?.state || null;
    if (!routeState || !routeState.autoRun) return;

    const incomingQuery = String(routeState.query || "").trim();
    const incomingPath = routeState.path || null;
    const key = JSON.stringify({ incomingQuery, incomingPath, autoRun: true });

    if (handledRouteStateRef.current === key) return;
    handledRouteStateRef.current = key;

    if (incomingQuery) {
      setQuery(incomingQuery);
    }
    (async () => {
      const incomingFolder = await resolveFolderForAutoRun(
        incomingPath || "",
        incomingQuery
      );
      if (incomingFolder) {
        setSelectedFolders([incomingFolder]);
        setProgressMessage(`Selected folder: ${getFolderDisplayName(incomingFolder)}`);
      }
      setPendingAutoRun({
        query: incomingQuery,
        path: incomingPath,
        scopeFolders: incomingFolder ? [incomingFolder] : [],
      });
    })();
  }, [location?.state]);

  useEffect(() => {
    if (!pendingAutoRun || loading) return;

    const autoQuery = String(pendingAutoRun.query || query || "").trim();
    if (!autoQuery) {
      setPendingAutoRun(null);
      return;
    }

    (async () => {
      await runSearch({
        query: autoQuery,
        path: pendingAutoRun.path || null,
        scopeFolders: pendingAutoRun.scopeFolders || [],
      });
      setPendingAutoRun(null);
    })();
  }, [pendingAutoRun, loading, query]);

  useEffect(() => {
    if (!pendingSearchAfterIndex || !canSearch || loading) return;
    runSearch();
  }, [pendingSearchAfterIndex, canSearch, loading]);

  return (
    <div className="sp-root">
      <div className="sp-project-title">Search Screenshots and Documents</div>
      <TopNav user={user} onSignOut={onSignOut} />

      <div className="sp-body">
        <aside className="sp-left">
          <div className="sp-card">
            <h3>Prepare Files</h3>

            <button
              className="btn-primary"
              disabled={isIndexing}
              onClick={pickFolderElectron}
            >
              {isIndexing ? "Preparing..." : "Add Folder to Search"}
            </button>

            <div className="index-actions-row">
              <button
                className="btn-outline"
                disabled={!isIndexing}
                onClick={() => stopIndexing()}
              >
                Stop
              </button>
              <button
                className="btn-outline"
                onClick={changeFolder}
              >
                Change Folder
              </button>
            </div>

            <label>Find by Similar Image</label>
            <div className="image-match-row">
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = () => {
                      setCaptureSource("gallery");
                      setCaptureUrl(String(reader.result || ""));
                      setCaptureLabel(file.name || "Gallery image");
                      setCrop({ unit: "%", x: 0, y: 0, width: 100, height: 100 });
                      setAspect(4 / 3);
                      setAspectPreset("free");
                      setCustomAspectW("4");
                      setCustomAspectH("3");
                      setCompletedCrop(null);
                      setShowCameraModal(true);
                    };
                    reader.readAsDataURL(file);
                  }
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />
              <button
                className="btn-outline"
                type="button"
                disabled={loading}
                onClick={handleGallerySelect}
              >
                Select Image (Gallery)
              </button>
              <button
                className="btn-outline"
                type="button"
                disabled={loading}
                onClick={openCameraModal}
              >
                Use Camera
              </button>
            </div>
            {imageSearchLabel ? (
              <div className="image-match-status">
                Selected image: {imageSearchLabel}
                <button
                  className="btn-outline clear-image-btn"
                  type="button"
                  onClick={() => {
                    if (matchQueryUrl && matchQueryUrl.startsWith("blob:")) {
                      URL.revokeObjectURL(matchQueryUrl);
                    }
                    setPendingImageFile(null);
                    setImageSearchLabel("");
                    setMatchQueryUrl("");
                    setMatchQueryLabel("");
                  }}
                >
                  Clear
                </button>
              </div>
            ) : null}

            <div
              className="progress-wrap"
              title={indexError || progressMessage || ""}
            >
              <div className="single-green-note">
                {selectedFolders.length
                  ? `Folder selected: ${getFolderDisplayName(selectedFolders[selectedFolders.length - 1])}`
                  : "Choose a folder to start."}
              </div>
              <div className="progress-track">
                <div
                  className={`progress-bar ${isIndexing ? "is-active" : ""} ${indexReady ? "is-ready" : ""}`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {indexError ? <div className="error-text">{indexError}</div> : null}
              {selectedFolders.length && !indexError && isIndexing ? (
                <div className="indexing-knowledge-note">
                  {folderTimingHint || "Please wait."}
                </div>
              ) : null}
            </div>

            <hr />

            <label>What are you looking for?</label>
            <input
              className={`sp-input ${showRequiredHints && !hasQuery ? "is-required" : ""}`}
              value={query}
              disabled={loading}
              placeholder="Type what you want to find"
              onChange={(e) => {
                setQuery(e.target.value);
                if (showRequiredHints) setShowRequiredHints(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
            />
            <div className="suggestion-wrap">
              <span className="suggestion-label">Try these suggestions:</span>
              <div className="suggestion-chips">
                {querySuggestionChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="suggestion-chip"
                    disabled={loading}
                    onClick={() => applyQuerySuggestion(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            <label>File kind</label>
            <select
              className={showRequiredHints && !isTypeChosen ? "is-required" : ""}
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                if (showRequiredHints) setShowRequiredHints(false);
              }}
              disabled={loading}
            >
              <option value="choose">Choose one</option>
              <option value="all">All</option>
              <option value="image">Image</option>
              <option value="document">Document</option>
            </select>

            <label>File format</label>
            <select
              value={extFilter}
              onChange={(e) => setExtFilter(e.target.value)}
              disabled={loading}
            >
              <option value="all">All</option>
              <option value="jpg">.jpg</option>
              <option value="jpeg">.jpeg</option>
              <option value="png">.png</option>
              <option value="webp">.webp</option>
              <option value="gif">.gif</option>
              <option value="bmp">.bmp</option>
              <option value="pdf">.pdf</option>
              <option value="txt">.txt</option>
              <option value="md">.md</option>
              <option value="csv">.csv</option>
              <option value="log">.log</option>
            </select>

            <label>Sort results</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              disabled={loading}
            >
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="size_desc">Size: High to Low</option>
              <option value="size_asc">Size: Low to High</option>
            </select>

            <label>Size (KB)</label>
            <div className="size-row">
              <input
                placeholder="min"
                value={sizeMin}
                disabled={loading}
                onChange={(e) => setSizeMin(e.target.value)}
              />
              <input
                placeholder="max"
                value={sizeMax}
                disabled={loading}
                onChange={(e) => setSizeMax(e.target.value)}
              />
            </div>

            <label>Date</label>
            <input
              type="date"
              value={dateFrom}
              disabled={loading}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <input
              type="date"
              value={dateTo}
              disabled={loading}
              onChange={(e) => setDateTo(e.target.value)}
            />

            <button
              className="btn-primary"
              onClick={runSearch}
              disabled={loading}
            >
              {loading ? (
                <span className="btn-loading">
                  <span className="btn-spinner" aria-hidden="true" />
                  Searching...
                </span>
              ) : (
                "Search"
              )}
            </button>
            {showRequiredHints && (!hasQuery || !isTypeChosen) ? (
              <div className="required-hint">
                Please fill: what to find and file kind.
              </div>
            ) : null}
          </div>
        </aside>

        <main className="sp-center">
          <div className="results-header">
            <h3>Best Matches</h3>
            <div className="results-controls">
              <label>
                Show
                <select
                  value={resultLimit}
                  onChange={(e) => setResultLimit(Number(e.target.value))}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={40}>40</option>
                  <option value={60}>60</option>
                </select>
                results
              </label>
              <button
                className="btn-outline"
                type="button"
                onClick={() => setShowAllResults((v) => !v)}
              >
                {showAllResults ? "Show Limited" : "Show All"}
              </button>
              <div className="results-count">
                Results: <strong>{stats.count}</strong>
              </div>
            </div>
          </div>
          <div className="top5-list">
            {(showAllResults ? results : results.slice(0, resultLimit)).map((f) => (
              <div
                key={f.path || f._id}
                className="top5-card"
                onClick={() => openLargePreview(f)}
              >
                <img
                  src={getImageSrc(f)}
                  alt={f.name || "preview"}
                  onError={(e) => {
                    e.currentTarget.src = getDocumentIcon(f);
                  }}
                />
                <div className="top5-content">
                  <strong>{f.name || "Untitled"}</strong>
                  {f._dupCount > 1 ? (
                    <span className="dup-badge">Copy ×{f._dupCount}</span>
                  ) : null}
                  {showOcrText ? <p>{getDescriptionSnippet(f)}...</p> : null}
                </div>
              </div>
            ))}
            {!results.length ? (
              <div className="empty-state">
                {canSearch
                  ? "No matching results yet."
                  : "Choose a folder and prepare files to see results."}
              </div>
            ) : null}
          </div>
        </main>
      </div>

      <Modal
        open={showPreviewModal && Boolean(selected)}
        title={selected?.name || "Image Preview"}
        onClose={() => {
          setShowPreviewModal(false);
          setShowShareMenu(false);
          setShareMenuBusy(false);
          setShareMenuPublicLink("");
          setShareMenuStatus("");
        }}
        width={980}
      >
        {selected ? (
          <div className="preview-modal-wrap">
            <div className="preview-modal-stage">
              <button
                className="btn-primary preview-action-btn preview-share-btn"
                type="button"
                onClick={() => openShareMenu(selected)}
              >
                Share
              </button>
              {showShareMenu ? (
                <div className="preview-share-menu">
                  {shareMenuStatus ? (
                    <div className="preview-share-status">{shareMenuStatus}</div>
                  ) : null}
                  <button
                    type="button"
                    className="preview-share-option"
                    onClick={() => shareByEmail(selected)}
                  >
                    Email
                  </button>
                  {shareMenuPublicLink ? (
                    <>
                      <button
                        type="button"
                        className="preview-share-option"
                        onClick={() => shareToWhatsApp(selected)}
                      >
                        WhatsApp
                      </button>
                      <button
                        type="button"
                        className="preview-share-option"
                        onClick={() => shareToMoreApps(selected)}
                      >
                        More Apps
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="preview-share-option"
                    onClick={() => {
                      handleShareFile(selected);
                      setShowShareMenu(false);
                    }}
                  >
                    Copy
                  </button>
                  {shareMenuBusy ? (
                    <div className="preview-share-status">Please wait...</div>
                  ) : null}
                </div>
              ) : null}
              <img
                className="preview-modal-image"
                src={getFullImageSrc(selected)}
                alt={selected.name || "preview"}
                style={{ transform: `scale(${previewZoom})` }}
                onError={(e) => {
                  e.currentTarget.src = getDocumentIcon(selected, true);
                }}
              />
            </div>

            {showOcrText ? (
              <div className="preview-modal-description">
                <h4>Text Found</h4>
                <p>{getMeaningfulDescription(selected)}</p>
              </div>
            ) : null}

            <div className="preview-chat-wrap">
              <h4>Ask About This File</h4>
              <div className="suggestion-wrap">
                <span className="suggestion-label">Try asking:</span>
                <div className="suggestion-chips">
                  {chatSuggestionChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className="suggestion-chip"
                      disabled={chatLoading}
                      onClick={() => applyChatSuggestion(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
              <div className="preview-chat-log">
                {chatMessages.length ? (
                  chatMessages.map((m, idx) => (
                    <div
                      key={`${m.role}-${idx}`}
                      className={`preview-chat-msg ${m.role === "assistant" ? "is-assistant" : "is-user"}`}
                    >
                      {m.text}
                    </div>
                  ))
                ) : (
                  <div className="preview-chat-empty">
                    Ask anything about this file.
                  </div>
                )}
                {chatLoading ? <div className="preview-chat-thinking">Thinking...</div> : null}
              </div>
              <div className="preview-chat-input-row">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask anything about this result..."
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      askAboutSelected();
                    }
                  }}
                />
                <button
                  className="btn-primary preview-action-btn"
                  type="button"
                  onClick={askAboutSelected}
                  disabled={chatLoading || !String(chatInput || "").trim()}
                >
                  {chatLoading ? "Asking..." : "Ask"}
                </button>
              </div>
            </div>

            {actionMessage ? <div className="action-message">{actionMessage}</div> : null}
            <div className="preview-modal-toolbar">
              <div className="preview-toolbar-left">
                <button
                  className="btn-primary preview-action-btn"
                  onClick={() => handleSaveItem(selected)}
                >
                  Save Item
                </button>
                <button
                  className="btn-primary preview-action-btn"
                  onClick={() => handleCopyDescription(selected)}
                >
                  Copy Description
                </button>
                <button
                  className="btn-primary preview-action-btn"
                  onClick={() => handleCopyPath(selected)}
                >
                  Copy File Location
                </button>
                <button
                  className="btn-primary preview-action-btn"
                  onClick={() => handleReOcrSelected(selected)}
                >
                  {ocrButtonLabel}
                </button>
                <button
                  className="btn-primary preview-action-btn"
                  onClick={() => handleOpenOriginal(selected)}
                >
                  Open Folder
                </button>
                {selected._dupCount > 1 ? (
                  <button
                    className="btn-primary preview-action-btn is-danger"
                    onClick={() => handleDeleteFile(selected)}
                  >
                    Remove Copy
                  </button>
                ) : null}
              </div>

              <div className="preview-toolbar-right">
                <button
                  className="btn-primary preview-action-btn is-subtle"
                  onClick={() => setPreviewZoom((z) => Math.max(0.5, z - 0.25))}
                >
                  Zoom -
                </button>
                <span className="zoom-chip">{Math.round(previewZoom * 100)}%</span>
                <button
                  className="btn-primary preview-action-btn is-subtle"
                  onClick={() => setPreviewZoom((z) => Math.min(3, z + 0.25))}
                >
                  Zoom +
                </button>
                <button
                  className="btn-primary preview-action-btn is-subtle"
                  onClick={() => setShowInspect((v) => !v)}
                >
                  {showInspect ? "Hide Details" : "Details"}
                </button>
              </div>
            </div>

            {showInspect ? (
              <pre className="preview-modal-inspect">
                {JSON.stringify(
                  {
                    name: selected.name || "",
                    path: selected.path || "",
                    type: selected.type || "",
                    sizeKB: selected.sizeKB || 0,
                    createdAt: selected.createdAt || null,
                    score: selected._score || selected.score || 0,
                  },
                  null,
                  2
                )}
              </pre>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={showCameraModal}
        title="Take Photo and Crop"
        onClose={closeCameraModal}
        width={900}
      >
        <div className="camera-modal">
          {cameraError ? <div className="camera-error">{cameraError}</div> : null}

          {!captureUrl ? (
            <div className="camera-stage">
              <video
                className="camera-video"
                ref={cameraVideoRef}
                autoPlay
                playsInline
                muted
              />
            </div>
          ) : (
            <div className="camera-cropper">
              <ReactCrop
                crop={crop}
                aspect={aspectPreset === "free" ? undefined : aspect}
                onChange={(_, percentCrop) => setCrop(percentCrop)}
                onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
                keepSelection
              >
                <img
                  ref={cropImageRef}
                  src={captureUrl}
                  alt={captureLabel || "Crop source"}
                  className="camera-crop-image"
                  crossOrigin="anonymous"
                />
              </ReactCrop>
            </div>
          )}

          <div className="camera-controls">
            {!captureUrl ? (
              <button className="btn-primary" onClick={capturePhoto}>
                Capture
              </button>
            ) : (
              <>
                <div className="camera-aspect">
                  <label>Aspect</label>
                  <div className="aspect-buttons">
                    <button
                      type="button"
                      className={aspectPreset === "1:1" ? "aspect-btn is-active" : "aspect-btn"}
                      onClick={() => {
                        setAspect(1);
                        setAspectPreset("1:1");
                      }}
                    >
                      1:1
                    </button>
                    <button
                      type="button"
                      className={aspectPreset === "4:3" ? "aspect-btn is-active" : "aspect-btn"}
                      onClick={() => {
                        setAspect(4 / 3);
                        setAspectPreset("4:3");
                      }}
                    >
                      4:3
                    </button>
                    <button
                      type="button"
                      className={aspectPreset === "16:9" ? "aspect-btn is-active" : "aspect-btn"}
                      onClick={() => {
                        setAspect(16 / 9);
                        setAspectPreset("16:9");
                      }}
                    >
                      16:9
                    </button>
                    <button
                      type="button"
                      className={aspectPreset === "free" ? "aspect-btn is-active" : "aspect-btn"}
                      onClick={() => setAspectPreset("free")}
                    >
                      Free
                    </button>
                    <button
                      type="button"
                      className={aspectPreset === "custom" ? "aspect-btn is-active" : "aspect-btn"}
                      onClick={applyCustomAspect}
                    >
                      Custom
                    </button>
                  </div>
                  <div className="custom-aspect-row">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={customAspectW}
                      onChange={(e) => setCustomAspectW(e.target.value)}
                      placeholder="W"
                    />
                    <span>:</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={customAspectH}
                      onChange={(e) => setCustomAspectH(e.target.value)}
                      placeholder="H"
                    />
                    <button
                      type="button"
                      className="aspect-btn"
                      onClick={applyCustomAspect}
                    >
                      Apply
                    </button>
                  </div>
                </div>
                <button className="btn-outline" onClick={() => setCaptureUrl("")}>
                  Retake
                </button>
                <button className="btn-primary" onClick={useCroppedImage}>
                  Use Cropped Image
                </button>
              </>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
