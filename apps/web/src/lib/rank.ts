/**
 * Ranking for the places that search a list of things by name.
 *
 * A bare subsequence test answers "could these letters be found in order" and
 * nothing else. That is a fine *filter* and a poor *sort*: typing `inst` would
 * put every entry containing an i, an n, an s and a t in insertion order, so
 * "Instances" could sit below a cluster that merely happened to be declared
 * first. A stricter test is not the answer - a subsequence match is genuinely
 * wanted, and `apsv` should still find `api-service` - a score is, so the
 * obvious answer sorts above the clever one.
 *
 * The ladder below is ordered by how deliberate a match looks. Each tier is far
 * enough above the next that no within-tier tie-break can cross it: a substring
 * hit never outranks a prefix hit, however short the string.
 */

const EXACT = 1000;
const PREFIX = 800;
const WORD = 600;
const SUBSTRING = 400;
const SUBSEQUENCE = 200;

/** What counts as the start of a word, so `svc` ranks on `api-svc`. */
const WORD_BREAK = /[\s\-_./:]/;

/**
 * How well `needle` matches `haystack`, or null if it does not at all.
 *
 * Both are compared case-insensitively; callers pass whatever casing they have.
 * An empty needle matches everything at zero, which keeps "no query" from
 * imposing an order of its own.
 */
export function scoreMatch(haystack: string, needle: string): number | null {
  const hay = haystack.toLowerCase();
  const query = needle.trim().toLowerCase();
  if (query.length === 0) return 0;

  const tier = tierFor(hay, query);
  if (tier === null) return null;

  // Shorter haystacks win within a tier: among things that all contain the
  // query, the one with least else in it is the one that was meant. Capped so
  // the bonus can never reach the next tier.
  return tier + Math.max(0, 100 - hay.length);
}

function tierFor(hay: string, query: string): number | null {
  if (hay === query) return EXACT;
  if (hay.startsWith(query)) return PREFIX;

  const at = hay.indexOf(query);
  if (at > 0) {
    const before = hay[at - 1] ?? "";
    return WORD_BREAK.test(before) ? WORD : SUBSTRING;
  }

  return isSubsequence(hay, query) ? SUBSEQUENCE : null;
}

/** Subsequence match: "apsv" finds "api-service". */
export function isSubsequence(haystack: string, needle: string): boolean {
  let position = 0;
  for (const char of needle) {
    position = haystack.indexOf(char, position);
    if (position === -1) return false;
    position += 1;
  }
  return true;
}

/**
 * Filters and sorts `items` by how well any of their texts match `needle`.
 *
 * An item is scored by its best-matching text rather than its first, so a name
 * that matches beats a description that matches on the same item - and an entry
 * whose keywords carry the word someone actually typed is reachable without
 * that word having to appear in its label.
 *
 * `boost` is added after scoring, for the orderings that are not about text at
 * all: a resource visited five minutes ago should outrank a cold one that reads
 * identically. It is deliberately additive and expected to be small, so it
 * settles ties rather than overturning the ladder.
 *
 * The sort is stable, so items that tie keep the order they were given in -
 * which is how the caller's own grouping survives ranking.
 */
export function rankBy<T>(
  items: ReadonlyArray<T>,
  needle: string,
  text: (item: T) => ReadonlyArray<string>,
  boost?: (item: T) => number,
): T[] {
  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    let best: number | null = null;
    for (const candidate of text(item)) {
      const score = scoreMatch(candidate, needle);
      if (score !== null && (best === null || score > best)) best = score;
    }
    if (best === null) continue;
    scored.push({ item, score: best + (boost?.(item) ?? 0) });
  }

  return scored.toSorted((a, b) => b.score - a.score).map((entry) => entry.item);
}
