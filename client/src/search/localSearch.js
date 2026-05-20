const MIN_CONFIDENCE = 0.75;

/* ---------- helpers ---------- */
function normalize(str = "") {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// NOTE: fuzzy similarity yahin hi rahegi,
// agar baad me fuzzy.js use karna ho to import kar sakti ho
function similarity(a = "", b = "") {
  if (!a || !b) return 0;
  const al = a.length;
  const bl = b.length;

  const dp = Array(bl + 1)
    .fill(0)
    .map((_, i) => i);

  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
        dp[j] + 1,
        dp[j - 1] + 1
      );
      prev = temp;
    }
  }

  return 1 - dp[bl] / Math.max(al, bl);
}

function computeScore(file, query) {
  const base = Number(file.score ?? 0.4);

  // 🔹 No query → base score only
  if (!query) return base;

  const text = (file.extractText || "").toLowerCase();
  const tokens = normalize(query);

  let matches = 0;
  tokens.forEach((t) => {
    if (text.includes(t)) matches++;
  });

  // OCR-based relevance
  return Math.min(
    0.999,
    base * 0.4 + (matches / Math.max(tokens.length, 1)) * 0.9
  );
}

/* ---------- MAIN LOCAL SEARCH ---------- */
export function runLocalSearch({ files, query, filters }) {
  const {
    typeFilter,
    sizeMin,
    sizeMax,
    dateFrom,
    dateTo,
  } = filters || {};

  let working = [...files];
  const q = (query || "").trim().toLowerCase();

  /* ----- basic filters ----- */
  working = working.filter((f) => {
    if (typeFilter && typeFilter !== "all") {
      if (typeFilter === "screenshot") {
        if (!(f.type === "screenshot" || f.type === "image")) return false;
      } else if (f.type !== typeFilter) return false;
    }

    const min = sizeMin ? Number(sizeMin) : 0;
    const max = sizeMax ? Number(sizeMax) : Infinity;
    if ((f.sizeKB || 0) < min || (f.sizeKB || 0) > max) return false;

    if (dateFrom && f.mtime < dateFrom) return false;
    if (dateTo && f.mtime > dateTo) return false;

    return true;
  });

  /* ----- exact match (FILENAME + OCR) ----- */
  if (q) {
    const qTokens = normalize(q);
    working = working.filter((f) => {
      const nameTokens = normalize(f.name || "");
      const nameMatch = qTokens.every((qt) =>
        nameTokens.some((nt) => nt.includes(qt))
      );
      const textMatch = (f.extractText || "").toLowerCase().includes(q);
      return nameMatch || textMatch;
    });
  }

  /* ----- fuzzy fallback ----- */
  let didYouMean = null;
  let infoMessage = "";

  if (q && working.length === 0) {
    const scored = files
      .map((f) => ({
        file: f,
        score: similarity(f.name || "", q),
      }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      working = scored.map((x) => x.file);
      infoMessage = `No exact matches — showing fuzzy results for "${query}".`;

      if (scored.length === 1 && scored[0].score >= 0.82) {
        didYouMean = {
          suggestion: scored[0].file.name,
          score: scored[0].score,
        };
      }
    } else {
      infoMessage = `No matches for "${query}".`;
    }
  }

  /* ----- scoring & ranking (FINAL FIX) ----- */
  const ranked = working
    .map((f) => ({
      ...f,
      score: computeScore(f, query),
      // 🔹 thumbnail preserved (VERY IMPORTANT)
      thumbnailUrl: f.thumbnailUrl || null,
    }))
    .filter((f) => {
      // 🔹 no query → show everything
      if (!q) return true;

      // 🔹 filename match should NEVER be dropped
      if (f.name?.toLowerCase().includes(q)) return true;

      // 🔹 otherwise rely on confidence
      return f.score >= MIN_CONFIDENCE;
    })
    .sort((a, b) => b.score - a.score);

  return {
    results: ranked,
    top5: ranked.slice(0, 5),
    infoMessage,
    didYouMean,
  };
}
