// client/src/search/scoring.js
export const MIN_CONFIDENCE = 0.75;

export function computeTextScore(file, query) {
  const base = Number(file.score ?? 0.4);
  if (!query) return base;

  const text = (file.extractText || "").toLowerCase();
  const words = query.toLowerCase().split(/\s+/);

  let hits = 0;
  words.forEach(w => { if (text.includes(w)) hits++; });

  return Math.min(0.999, base * 0.4 + (hits / words.length) * 0.9);
}
