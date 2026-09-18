/**
 * Resolves a CSS custom property to a `#rrggbb` string.
 *
 * The palette is written in oklch, and the two things we hand colours to -
 * Monaco and xterm - both want hex. Rather than keep a second palette in sync
 * by hand, the browser does the colour-space conversion for us: assign the
 * value to an element, read `getComputedStyle` back, and it comes out as
 * `rgb(...)`.
 *
 * Passing oklch straight through is tempting, since xterm's `ITheme` accepts
 * CSS colour strings. Don't: its WebGL renderer parses colours itself, and that
 * parser has historically understood less than the CSSOM does.
 */

/** The DOM-free half, so the parsing is testable without a browser. */
export function parseRgbToHex(computed: string): string | null {
  const match = /rgba?\(([^)]+)\)/.exec(computed);
  if (!match?.[1]) return null;

  const [r, g, b] = match[1].split(/[\s,/]+/).map(Number);
  if (r === undefined || g === undefined || b === undefined) return null;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

function hexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

export function cssColor(variable: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  if (!raw) return fallback;

  const probe = document.createElement("span");
  probe.style.color = raw;
  probe.style.display = "none";
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  return parseRgbToHex(resolved) ?? fallback;
}
