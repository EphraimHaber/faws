/* eslint-disable no-control-regex -- matching control characters is this
   module's entire purpose; every regex below is deliberate. */

/**
 * Renders the colour a program already asked for.
 *
 * Anything logging through Rust's `tracing`, Go's `slog` with a tint handler,
 * pino-pretty or a plain `--color` flag writes SGR escape sequences into its
 * output. CloudWatch stores them verbatim, so printing the raw text shows
 * `[2m[32m INFO[0m` — noise wrapped around the very thing it was meant to
 * emphasise.
 *
 * Colours map onto the app's own palette rather than literal ANSI red/green,
 * so a log line stays legible in both themes and matches the surrounding UI.
 */
export interface AnsiSpan {
  readonly text: string;
  readonly className: string;
}

interface SgrState {
  color: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

const EMPTY: SgrState = {
  color: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
};

/**
 * Standard and bright foreground codes. Black and white are deliberately not
 * mapped to black and white: on a dark ground "black" is unreadable, and the
 * intent behind both is "de-emphasised" and "emphasised".
 */
// These are the same palette decisions lib/terminal/theme.ts renders as the
// 16 ANSI colours for xterm, via the --term-* properties in index.css. A
// change to what 31 or 32 means belongs in both.
const COLORS: Readonly<Record<number, string>> = {
  30: "text-muted-foreground/70",
  31: "text-danger",
  32: "text-success",
  33: "text-warning",
  34: "text-info",
  35: "text-primary",
  36: "text-primary",
  37: "text-foreground",
  90: "text-muted-foreground",
  91: "text-danger",
  92: "text-success",
  93: "text-warning",
  94: "text-info",
  95: "text-primary",
  96: "text-primary",
  97: "text-foreground",
};

// CSI ... m — the SGR subset. Other sequences (cursor moves, erases) are
// stripped rather than interpreted: they mean nothing in a scrollback pane.
const ANSI_PATTERN =
  /\u001B\[([0-9;]*)m|\u001B\[[0-9;?]*[A-Za-z]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu;

export function parseAnsi(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let state: SgrState = { ...EMPTY };
  let cursor = 0;

  const push = (text: string) => {
    if (text.length === 0) return;
    const className = classNameFor(state);
    const previous = spans.at(-1);
    // Adjacent runs with identical styling merge, so a line that toggles
    // attributes between every word doesn't become dozens of elements.
    if (previous && previous.className === className) {
      spans[spans.length - 1] = { text: previous.text + text, className };
      return;
    }
    spans.push({ text, className });
  };

  for (const match of input.matchAll(ANSI_PATTERN)) {
    const index = match.index;
    push(input.slice(cursor, index));
    cursor = index + match[0].length;

    // Only the SGR branch captures; the others are stripped with no effect.
    const codes = match[1];
    if (codes === undefined) continue;
    state = applySgr(state, codes);
  }
  push(input.slice(cursor));

  return spans.length > 0 ? spans : [{ text: "", className: "" }];
}

function applySgr(state: SgrState, codes: string): SgrState {
  // A bare `ESC[m` is shorthand for a full reset.
  const parts = codes.length === 0 ? [0] : codes.split(";").map((part) => Number(part || "0"));
  let next = { ...state };

  for (const code of parts) {
    if (Number.isNaN(code)) continue;
    if (code === 0) next = { ...EMPTY };
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) next = { ...next, bold: false, dim: false };
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code === 39) next.color = null;
    else if (COLORS[code]) next.color = COLORS[code] ?? null;
  }

  return next;
}

function classNameFor(state: SgrState): string {
  const classes: string[] = [];
  // Dim wins over an explicit colour: it is the signal that this run is
  // structural punctuation rather than content, which is exactly what Rust's
  // tracing uses it for.
  if (state.dim) classes.push("text-muted-foreground/70");
  else if (state.color) classes.push(state.color);
  if (state.bold) classes.push("font-semibold");
  if (state.italic) classes.push("italic");
  if (state.underline) classes.push("underline");
  return classes.join(" ");
}

/** True when a line carries escape sequences at all. */
export function hasAnsi(input: string): boolean {
  return /\u001B\[/u.test(input);
}

/** Drops every sequence, for the clipboard and for plain-text search. */
export function stripAnsi(input: string): string {
  return input.replaceAll(ANSI_PATTERN, "");
}
