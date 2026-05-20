// client/src/search/fuzzy.js

export function levenshtein(a = "", b = "") {
  a = a.toLowerCase();
  b = b.toLowerCase();

  const al = a.length;
  const bl = b.length;

  if (!al) return bl;
  if (!bl) return al;

  const dp = Array(bl + 1)
    .fill(0)
    .map((_, i) => i);

  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;

    for (let j = 1; j <= bl; j++) {
      const cur = dp[j];
      dp[j] = Math.min(
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
        dp[j] + 1,
        dp[j - 1] + 1
      );
      prev = cur;
    }
  }

  return dp[bl];
}

/**
 * Returns similarity score between 0 and 1
 * 1 = exact match
 */
export function similarity(a = "", b = "") {
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return Math.max(0, 1 - dist / Math.max(a.length, b.length));
}
