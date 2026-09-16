/**
 * Log search has two audiences and they want opposite things.
 *
 * Someone chasing an IP or a request id wants to type `10-0` and get hits.
 * CloudWatch filter patterns are a query language, not substring search, so
 * that input matches nothing at all — `-` is syntax, not a character to look
 * for — while `ip` happens to work because it is a bare term. A box that fails
 * silently on exactly the inputs worth searching for (IPs, timestamps, UUIDs,
 * paths) is worse than one that never worked.
 *
 * Someone who knows the language wants `{$.level = "error"}` sent verbatim.
 *
 * Rather than guess which one is typing, the mode is explicit and the
 * resulting pattern is shown back, so the box is usable without knowing the
 * language and teaches it to anyone who looks.
 */
export type LogFilterMode = "search" | "pattern";

/** The pattern actually sent to CloudWatch, or null when nothing is filtered. */
export function toFilterPattern(input: string, mode: LogFilterMode): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (mode === "pattern") return trimmed;
  // Backslashes first: escaping the quotes would otherwise be undone by it.
  return `"${trimmed.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`)}"`;
}

const PATTERN_PREFIXES = ["{", "[", '"', "?", "-"] as const;

/**
 * Whether the text looks like someone reaching for the query language while in
 * plain-search mode — used to offer the switch rather than to take it.
 */
export function looksLikePattern(input: string): boolean {
  const trimmed = input.trim();
  return PATTERN_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export interface PatternExample {
  readonly pattern: string;
  readonly description: string;
}

/** Shown in the pattern-mode hint; each is valid CloudWatch syntax. */
export const PATTERN_EXAMPLES: ReadonlyArray<PatternExample> = [
  { pattern: '"exact substring"', description: "literal text, punctuation included" },
  { pattern: "ERROR", description: "a bare term" },
  { pattern: "?ERROR ?WARN", description: "either term" },
  { pattern: "-healthcheck", description: "everything except" },
  { pattern: '{$.level = "error"}', description: "JSON property equals" },
  { pattern: "{$.duration > 500}", description: "JSON property compared" },
  { pattern: '{$.msg = "*timeout*"}', description: "JSON property contains" },
];
