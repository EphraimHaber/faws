/**
 * Highlighting for structured log lines.
 *
 * Plenty of services log a single JSON object per line. Rendered as flat text
 * it is the least readable format in the pane — every field name, quote and
 * brace weighs the same as the message. Tokenising it separates the shape from
 * the content, and the same tokens can be re-laid out as indented JSON when a
 * line is worth reading properly.
 *
 * This is a tokeniser rather than a syntax-highlighting library because the
 * input is one known language on one line: Prism or Shiki would bring a theme
 * to reconcile with the app's palette and a parser for languages that never
 * appear here.
 */
export type JsonTokenKind =
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation"
  | "whitespace";

export interface JsonToken {
  readonly text: string;
  readonly kind: JsonTokenKind;
}

export interface JsonLine {
  /** Anything before the JSON started, e.g. a timestamp the runtime prefixed. */
  readonly prefix: string;
  readonly tokens: ReadonlyArray<JsonToken>;
  /** The parsed value, for re-rendering indented. */
  readonly value: unknown;
}

const TOKEN_PATTERN =
  /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]|\s+/gu;

/**
 * Returns the tokens of a line's JSON payload, or null when the line isn't
 * structured.
 *
 * `JSON.parse` decides, rather than a regex: a line merely containing braces
 * is not a structured log, and highlighting it as one would be a confident
 * lie about its shape.
 */
export function parseJsonLine(text: string): JsonLine | null {
  const start = firstStructuralIndex(text);
  if (start === -1) return null;

  const candidate = text.slice(start).trimEnd();
  if (candidate.length === 0) return null;

  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    return null;
  }
  // A bare string or number on its own line is not a structured log.
  if (value === null || typeof value !== "object") return null;

  return { prefix: text.slice(0, start), tokens: tokenize(candidate), value };
}

function firstStructuralIndex(text: string): number {
  const brace = text.indexOf("{");
  const bracket = text.indexOf("[");
  if (brace === -1) return bracket;
  if (bracket === -1) return brace;
  return Math.min(brace, bracket);
}

export function tokenize(json: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let cursor = 0;

  for (const match of json.matchAll(TOKEN_PATTERN)) {
    const index = match.index;
    // Anything the pattern skipped is malformed; keep it rather than drop it,
    // so the rendered line always equals the input.
    if (index > cursor) {
      tokens.push({ text: json.slice(cursor, index), kind: "punctuation" });
    }
    const text = match[0];
    cursor = index + text.length;
    tokens.push({ text, kind: classify(text, json, cursor) });
  }
  if (cursor < json.length) {
    tokens.push({ text: json.slice(cursor), kind: "punctuation" });
  }

  return tokens;
}

function classify(text: string, json: string, after: number): JsonTokenKind {
  if (/^\s+$/u.test(text)) return "whitespace";
  if (text.startsWith('"')) {
    // A string is a key when the next non-space character is a colon.
    return /^\s*:/u.test(json.slice(after)) ? "key" : "string";
  }
  if (text === "true" || text === "false") return "boolean";
  if (text === "null") return "null";
  if (/^-?\d/u.test(text)) return "number";
  return "punctuation";
}

/** Palette classes, shared by the inline and expanded renderings. */
export const TOKEN_CLASS: Readonly<Record<JsonTokenKind, string>> = {
  key: "text-primary",
  string: "text-success",
  number: "text-warning",
  boolean: "text-info",
  null: "text-muted-foreground",
  punctuation: "text-muted-foreground/60",
  whitespace: "",
};

/**
 * The text of a structured line as it is shown: indented when expanded, the
 * single line it arrived as when not. What a copy of the line should hold, so
 * that pasting it gives what was on screen.
 */
export function jsonLineText(line: JsonLine, expanded: boolean): string {
  const body = expanded
    ? JSON.stringify(line.value, null, 2)
    : line.tokens.map((token) => token.text).join("");
  return `${line.prefix}${body}`;
}

/** The leading tokens that fit in `chars` characters, the last one cut to fit. */
export function clipTokens(
  tokens: ReadonlyArray<JsonToken>,
  chars: number,
): ReadonlyArray<JsonToken> {
  const kept: JsonToken[] = [];
  let left = chars;
  for (const token of tokens) {
    if (left <= 0) return kept;
    kept.push(token.text.length > left ? { ...token, text: token.text.slice(0, left) } : token);
    left -= token.text.length;
  }
  return tokens;
}
