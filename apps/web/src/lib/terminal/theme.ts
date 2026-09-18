import type { ITheme } from "@xterm/xterm";

import { cssColor } from "../css-color.ts";

/**
 * The app palette, as the 16 ANSI colours xterm wants.
 *
 * The colours themselves live in index.css as `--term-*` custom properties, so
 * a terminal and a log line agree about what "red" means. The same decisions
 * are encoded for the log pane's SGR parser in lib/ansi.ts, which maps to
 * Tailwind classes rather than colours - the two are two renderings of one
 * palette, so change them together.
 *
 * The resolver is a parameter so the mapping can be tested without a DOM, which
 * leaves only the browser probe untested. That is the right split: the probe is
 * four lines of CSSOM, the mapping is the part with 20 chances to typo a name.
 */
export function buildTerminalTheme(
  resolve: (variable: string, fallback: string) => string,
): ITheme {
  return {
    background: resolve("--term-bg", "#101418"),
    foreground: resolve("--term-fg", "#e6edf3"),
    cursor: resolve("--term-cursor", "#6cb6ff"),
    cursorAccent: resolve("--term-bg", "#101418"),
    selectionBackground: resolve("--term-selection", "#2d5b7f"),

    black: resolve("--term-black", "#6a737d"),
    red: resolve("--term-red", "#f85149"),
    green: resolve("--term-green", "#3fb950"),
    yellow: resolve("--term-yellow", "#d29922"),
    blue: resolve("--term-blue", "#58a6ff"),
    magenta: resolve("--term-magenta", "#bc8cff"),
    cyan: resolve("--term-cyan", "#39c5cf"),
    white: resolve("--term-white", "#b1bac4"),

    brightBlack: resolve("--term-bright-black", "#8b949e"),
    brightRed: resolve("--term-bright-red", "#ff7b72"),
    brightGreen: resolve("--term-bright-green", "#56d364"),
    brightYellow: resolve("--term-bright-yellow", "#e3b341"),
    brightBlue: resolve("--term-bright-blue", "#79c0ff"),
    brightMagenta: resolve("--term-bright-magenta", "#d2a8ff"),
    brightCyan: resolve("--term-bright-cyan", "#56d4dd"),
    brightWhite: resolve("--term-bright-white", "#f0f6fc"),
  };
}

/** The live theme, read from whichever palette is currently on the document. */
export function terminalTheme(): ITheme {
  return buildTerminalTheme(cssColor);
}
