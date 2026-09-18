/**
 * The live xterm instances, and the rules for keeping them alive.
 *
 * Terminals live in a module-level map rather than in React state or the
 * zustand store, for three reasons that all point the same way: an xterm holds
 * a DOM subtree and a WebGL context, so putting it in state means devtools
 * serialises it and every unrelated write churns selector identity; keeping
 * them out of anything serialisable is what structurally guarantees a
 * passphrase never lands in persisted state; and it lets a pane unmount and
 * remount - which route navigation does constantly - without losing scrollback,
 * cursor position or a half-typed command.
 */
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";

import { detectPlatform, isAppChord } from "./keys.ts";
import { terminalFontFamily, terminalTheme } from "./theme.ts";

export interface TerminalRuntime {
  readonly term: Terminal;
  readonly fit: FitAddon;
  readonly search: SearchAddon;
  webgl: WebglAddon | null;
  host: HTMLElement | null;
  observer: ResizeObserver | null;
  frame: number | null;
}

const runtimes = new Map<string, TerminalRuntime>();
const platform = detectPlatform();

export interface CreateOptions {
  onData(chunk: Uint8Array): void;
  onResize(cols: number, rows: number): void;
  onFocusChange(focused: boolean): void;
}

const encoder = new TextEncoder();

export function createTerminal(sessionId: string, options: CreateOptions): TerminalRuntime {
  const existing = runtimes.get(sessionId);
  if (existing) return existing;

  const term = new Terminal({
    // 10k lines at 200 columns is roughly 20MB; enough to scroll back through a
    // build log, bounded enough that a dozen tabs is not a memory problem.
    scrollback: 10_000,
    cursorBlink: true,
    cursorStyle: "bar",
    macOptionIsMeta: true,
    // Transparency costs real render time, and the dock has an opaque card
    // behind it anyway.
    allowTransparency: false,
    // We own the palette; letting xterm "fix" contrast would undo it.
    minimumContrastRatio: 1,
    fontFamily: terminalFontFamily(),
    fontSize: 12.5,
    lineHeight: 1.2,
    theme: terminalTheme(),
  });

  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon());

  // Returning false tells xterm not to handle the key, which lets it reach the
  // document listener the app's hotkeys are registered on.
  term.attachCustomKeyEventHandler((event) => !isAppChord(event, platform));

  term.onData((data) => options.onData(encoder.encode(data)));
  // Mouse reports and bracketed paste arrive here rather than through onData;
  // without this htop's mouse does nothing.
  term.onBinary((data) => {
    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 1) bytes[i] = data.charCodeAt(i) & 0xff;
    options.onData(bytes);
  });

  const runtime: TerminalRuntime = {
    term,
    fit,
    search,
    webgl: null,
    host: null,
    observer: null,
    frame: null,
  };
  runtimes.set(sessionId, runtime);

  term.onResize(({ cols, rows }) => options.onResize(cols, rows));
  return runtime;
}

export function getTerminal(sessionId: string): TerminalRuntime | undefined {
  return runtimes.get(sessionId);
}

/**
 * Attaches a terminal to a host element, or moves it to a new one.
 *
 * Idempotent on purpose: React runs effects twice under StrictMode, and a
 * non-idempotent mount produces two cursors and doubled keystrokes in dev while
 * looking perfectly fine in production.
 */
export function mountTerminal(
  sessionId: string,
  host: HTMLElement,
  onFocusChange: (focused: boolean) => void,
): void {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return;
  if (runtime.host === host) return;

  runtime.term.open(host);
  runtime.host = host;

  const textarea = runtime.term.textarea;
  if (textarea) {
    // Real DOM focus, not a click handler: that is the only thing that stays
    // correct when focus moves by keyboard or is taken by something else.
    textarea.addEventListener("focus", () => onFocusChange(true));
    textarea.addEventListener("blur", () => onFocusChange(false));
  }

  runtime.observer?.disconnect();
  const observer = new ResizeObserver(() => {
    // Coalesced through a frame: a drag fires these continuously, and fitting
    // is a full reflow that also emits a resize to the server.
    if (runtime.frame !== null) return;
    runtime.frame = requestAnimationFrame(() => {
      runtime.frame = null;
      safeFit(sessionId);
    });
  });
  observer.observe(host);
  runtime.observer = observer;

  safeFit(sessionId);
}

/**
 * Fits the terminal to its host, if that is currently a meaningful thing to do.
 *
 * Every guard here is a real failure. A hidden pane measures 0x0, from which
 * FitAddon proposes nonsense that would resize the remote shell to something
 * absurd; a detached host measures nothing at all. This is also why inactive
 * panes are hidden with `visibility` rather than `display: none` - the latter
 * yields 0x0 and silences the ResizeObserver, so the pane never recovers.
 */
export function safeFit(sessionId: string): { cols: number; rows: number } | null {
  const runtime = runtimes.get(sessionId);
  const host = runtime?.host;
  if (!runtime || !host?.isConnected) return null;
  if (host.clientWidth === 0 || host.clientHeight === 0) return null;

  const proposed = runtime.fit.proposeDimensions();
  if (!proposed) return null;
  const { cols, rows } = proposed;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) return null;

  runtime.term.resize(cols, rows);
  return { cols, rows };
}

/**
 * WebGL is attached only to the pane in front.
 *
 * Browsers cap live WebGL contexts at around 16 and silently evict the oldest,
 * so a dozen mounted-but-hidden panes would blank each other out. Losing the
 * addon costs nothing but render speed: xterm falls back to its DOM renderer.
 */
export function setRendererActive(sessionId: string, active: boolean): void {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return;

  if (!active) {
    runtime.webgl?.dispose();
    runtime.webgl = null;
    return;
  }
  if (runtime.webgl) return;

  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => {
      addon.dispose();
      runtime.webgl = null;
    });
    runtime.term.loadAddon(addon);
    runtime.webgl = addon;
  } catch {
    // No WebGL here; the DOM renderer is already what we have.
    runtime.webgl = null;
  }
}

export function writeToTerminal(sessionId: string, chunk: Uint8Array): void {
  runtimes.get(sessionId)?.term.write(chunk);
}

export function focusTerminal(sessionId: string): void {
  runtimes.get(sessionId)?.term.focus();
}

export function blurTerminal(sessionId: string): void {
  runtimes.get(sessionId)?.term.blur();
}

/** Stops accepting input, for a session whose far end has gone. */
export function freezeTerminal(sessionId: string): void {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return;
  runtime.term.options.disableStdin = true;
  runtime.term.options.cursorBlink = false;
}

export function applyTheme(): void {
  const theme = terminalTheme();
  for (const runtime of runtimes.values()) {
    runtime.term.options.theme = theme;
    // The DOM renderer keeps painted cells until something invalidates them.
    runtime.term.refresh(0, runtime.term.rows - 1);
  }
}

export function disposeTerminal(sessionId: string): void {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return;
  if (runtime.frame !== null) cancelAnimationFrame(runtime.frame);
  runtime.observer?.disconnect();
  runtime.webgl?.dispose();
  runtime.term.dispose();
  runtimes.delete(sessionId);
}
