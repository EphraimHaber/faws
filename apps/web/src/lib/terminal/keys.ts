/**
 * Who gets a keystroke while a terminal has focus: the app, or the shell.
 *
 * There are two layers that both have to agree, which is why this is one pure
 * predicate rather than a condition written twice. xterm asks
 * `attachCustomKeyEventHandler` whether to process a key, and the app's hotkeys
 * are registered on `document` with `stopPropagation`, so a binding that fires
 * also takes the key away from xterm. If the two disagree, keys fall into the
 * gap and nothing happens at all.
 *
 * The default is emphatically the terminal. A shell wants Ctrl+C, Ctrl+D,
 * Ctrl+L, Ctrl+A, Ctrl+R and every arrow and function key, and a terminal that
 * swallows a stray keystroke is a mild annoyance while one that leaks Ctrl+C to
 * the page cannot interrupt a runaway command.
 *
 * Note what is not here: plain letters. `@tanstack/hotkeys` already ignores
 * single keys while focus is in an input, and xterm's input sink is a real
 * textarea, so j/k/h/?/R are handled for free.
 */

export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export type Platform = "mac" | "other";

export function detectPlatform(): Platform {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "mac"
    : "other";
}

/** Keys the dock's own chords are built from, all under Mod+Alt. */
const DOCK_CHORD_KEYS = new Set(["t", "w", "f", "[", "]", "Enter"]);

/**
 * True when the app should handle this key and the terminal should not.
 *
 * The platform split is not cosmetic. On macOS the app's modifier is Cmd, which
 * no shell binds, so Cmd+K can open the palette and Cmd+C/V can copy and paste
 * with nothing lost. Everywhere else the app's modifier is Ctrl, which the shell
 * very much does bind - Ctrl+K is kill-line - so those stay with the terminal
 * and the app is reached through the one escape hatch below.
 */
export function isAppChord(event: KeyEventLike, platform: Platform): boolean {
  const mod = platform === "mac" ? event.metaKey : event.ctrlKey;

  // The escape hatch, and the only binding that must work on every platform:
  // hand focus back to the page. Without it a focused terminal on Linux is a
  // keyboard trap.
  if (mod && event.key === "Escape") return true;

  // Ctrl+backtick toggles the dock. Chosen over Mod+backtick because Cmd+backtick
  // is "cycle windows" on macOS, and because this is where VS Code puts it.
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "`") return true;

  // The dock's own chords live under one namespace so they are easy to explain
  // and hard to collide with. Alt is what keeps them clear of a shell's Ctrl
  // bindings on Linux.
  if (mod && event.altKey && DOCK_CHORD_KEYS.has(event.key)) return true;

  // Beyond this point the terminal keeps everything on a non-mac platform,
  // because there Mod is Ctrl and Ctrl belongs to the shell.
  if (platform !== "mac") return false;

  // On mac, Cmd is free. Let the app keep the chords it already owns.
  if (event.metaKey && !event.ctrlKey) {
    // Copy, paste and select-all are the terminal's on any platform - xterm
    // handles them itself against the selection.
    if (event.key === "c" || event.key === "v" || event.key === "a") return false;
    return true;
  }

  return false;
}
