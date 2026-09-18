/**
 * Serving the SPA shell with the current settings already in it.
 *
 * This is what makes the desktop app open in the right theme instead of
 * flashing. The renderer's `localStorage` fallback cannot help there: the
 * packaged shell starts the server on an OS-assigned port, so every launch is
 * a different browser origin and every launch starts with empty storage. The
 * settings the server already has in memory are inlined into the document
 * instead, and the first paint is correct with no fetch at all.
 *
 * The inline script is deliberately tiny and dependency-free - it runs before
 * the bundle, and anything it throws would be a blank window.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Settings } from "@faws/contracts";

const MARKER = "<!--faws:settings-->";

/**
 * Applies the theme before the bundle parses, so there is no flash.
 *
 * Duplicated from `ThemeContext` on purpose: React cannot run early enough to
 * do this, and the duplication is two DOM calls rather than a shared module
 * that would have to be loaded to be useful.
 */
const BOOTSTRAP = `
  try {
    var t = window.fawsSettings.appearance.theme;
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
  } catch (e) {}
`;

/**
 * Reads the shell once and caches it; only the injected payload changes.
 *
 * Re-reading per request would put a stat and a read in front of every page
 * load to serve a file that cannot change without a redeploy.
 */
export function createIndexHtmlRenderer(root: string): (settings: Settings) => Promise<string> {
  let shell: Promise<string> | null = null;

  return async (settings) => {
    shell ??= fs.readFile(path.join(root, "index.html"), "utf8");
    const template = await shell;
    const payload = `<script>window.fawsSettings=${serialize(settings)};${BOOTSTRAP}</script>`;
    if (template.includes(MARKER)) return template.replace(MARKER, payload);
    // No marker: put it last in <head> so it still beats the module script.
    return template.replace("</head>", `${payload}</head>`);
  };
}

/**
 * JSON that is safe to sit inside a `<script>` element.
 *
 * `</script>` anywhere in the data - an AWS profile named oddly, a label
 * pasted from somewhere - would otherwise close the tag early and put the
 * rest of the settings on the page as markup.
 */
function serialize(settings: Settings): string {
  return JSON.stringify(settings)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}
