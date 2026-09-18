/**
 * Key matching for the object browser.
 *
 * Plain text is a case insensitive substring, which is what someone typing a
 * few characters into a filter box means. Anything carrying a wildcard becomes
 * an anchored pattern instead, so `*.json` matches whole names rather than
 * appearing to match nothing.
 */

const WILDCARD = /[*?[\]]/;

/** Whether the query is a pattern rather than a plain substring. */
export function isPattern(query: string): boolean {
  return WILDCARD.test(query);
}

/**
 * Whether answering this query needs every key under the prefix.
 *
 * A query that spans separators cannot be answered from one folder's listing,
 * so it escalates to a recursive scan on its own rather than quietly matching
 * nothing.
 */
export function requiresDeep(query: string): boolean {
  return query.includes("/") || query.includes("**");
}

/**
 * A matcher for one query.
 *
 * Compiled once and reused across every key, because a scan applies it to
 * hundreds of thousands of them.
 */
export function compileMatcher(query: string): (value: string) => boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return () => true;

  if (!isPattern(trimmed)) {
    const needle = trimmed.toLowerCase();
    return (value) => value.toLowerCase().includes(needle);
  }

  const regex = globToRegex(trimmed);
  return (value) => regex.test(value);
}

/**
 * The glob dialect, as an anchored case insensitive expression.
 *
 * `*` stops at a separator and `**` crosses them, which is the distinction
 * that makes `*.json` mean "in this folder" and `**\/*.json` mean "anywhere
 * below". `?` is one character, and `[...]` a class, negated with a leading
 * `!` or `^`.
 */
export function globToRegex(pattern: string): RegExp {
  let out = "";

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];

    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // Consume the run, so `***` is not three separate wildcards.
        while (pattern[i + 1] === "*") i += 1;
        out += ".*";
      } else {
        out += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      out += "[^/]";
      continue;
    }

    if (char === "[") {
      const close = pattern.indexOf("]", i + 1);
      // An unclosed bracket is a literal one; the alternative is a pattern
      // that throws while someone is still typing it.
      if (close === -1) {
        out += "\\[";
        continue;
      }
      let body = pattern.slice(i + 1, close);
      if (body.startsWith("!") || body.startsWith("^")) body = `^${body.slice(1)}`;
      out += `[${body}]`;
      i = close;
      continue;
    }

    out += escapeLiteral(char ?? "");
  }

  return new RegExp(`^${out}$`, "i");
}

function escapeLiteral(char: string): string {
  return /[.+^${}()|\\]/.test(char) ? `\\${char}` : char;
}
