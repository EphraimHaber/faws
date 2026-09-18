/**
 * Monaco setup.
 *
 * Two things matter here:
 *
 * 1. **No CDN, no network at all.** Monaco and its workers are bundled by
 *    Vite, and the imports are the JSON-only entry points rather than the
 *    `monaco-editor` barrel, which drags in every language — a 7MB TypeScript
 *    worker included — to render one JSON document.
 * 2. **The themes follow our CSS palette.** Monaco only accepts hex, while the
 *    palette is oklch custom properties, so the colours are resolved from the
 *    live computed styles and re-applied whenever the theme flips. One source
 *    of truth, no second palette to keep in sync by hand.
 */
import * as monaco from "monaco-editor/editor/editor.api";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import "monaco-editor/language/json/monaco.contribution";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";

import { cssColor } from "./css-color.ts";

/**
 * A single theme, redefined in place on every flip. Two fixed themes would
 * have to be built from both palettes at once, and only one palette is
 * resolvable from the DOM at any moment.
 */
export const MONACO_THEME = "faws";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

// Monaco reads this the first time it needs a worker, so it is assigned at
// module scope rather than behind an init call an editor could race.
window.MonacoEnvironment = {
  getWorker(_workerId, label) {
    return label === "json" ? new jsonWorker() : new editorWorker();
  },
};

/**
 * (Re)defines the theme from the current palette. Call after a theme flip —
 * the custom properties have new values by then, so the editor chrome tracks
 * the rest of the app instead of shipping Monaco's stock grey.
 */
export function defineMonacoTheme(): void {
  const background = cssColor("--card", "#1c1f26");
  const foreground = cssColor("--card-foreground", "#e8eaee");
  const muted = cssColor("--muted-foreground", "#9aa1ad");
  const primary = cssColor("--primary", "#7fd4e8");
  const success = cssColor("--success", "#5fd39a");
  const warning = cssColor("--warning", "#e0b357");
  const border = cssColor("--border", "#2a2e37");
  const isDark = document.documentElement.classList.contains("dark");

  const rules: monaco.editor.ITokenThemeRule[] = [
    { token: "string.key.json", foreground: primary.slice(1) },
    { token: "string.value.json", foreground: success.slice(1) },
    { token: "number", foreground: warning.slice(1) },
    { token: "keyword.json", foreground: warning.slice(1) },
    { token: "comment", foreground: muted.slice(1), fontStyle: "italic" },
  ];

  const colors = {
    "editor.background": background,
    "editor.foreground": foreground,
    "editorLineNumber.foreground": border,
    "editorLineNumber.activeForeground": muted,
    "editor.lineHighlightBackground": background,
    "editorIndentGuide.background1": border,
    "editorIndentGuide.activeBackground1": muted,
    "editorGutter.background": background,
    "editorWidget.background": background,
    "editorWidget.border": border,
    "editor.selectionBackground": `${primary}33`,
    "editor.inactiveSelectionBackground": `${primary}1f`,
    "editor.findMatchBackground": `${warning}66`,
    "editor.findMatchHighlightBackground": `${warning}33`,
    "scrollbarSlider.background": `${muted}33`,
    "scrollbarSlider.hoverBackground": `${muted}55`,
    "scrollbarSlider.activeBackground": `${muted}77`,
  };

  monaco.editor.defineTheme(MONACO_THEME, {
    base: isDark ? "vs-dark" : "vs",
    inherit: true,
    rules,
    colors,
  });
  monaco.editor.setTheme(MONACO_THEME);
}
