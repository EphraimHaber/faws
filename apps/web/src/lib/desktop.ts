/**
 * The Electron preload bridge, as the renderer sees it.
 *
 * Everything here is optional: the same build runs in a plain browser via
 * `pnpm dev:web`, where `window.faws` is simply absent.
 */
export interface DesktopBridge {
  readonly platform: string;
  openLogFile(): Promise<void>;
  showLogDir(): Promise<void>;
  onFullscreenChange(listener: (fullscreen: boolean) => void): () => void;
}

declare global {
  interface Window {
    readonly faws?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | null {
  return typeof window === "undefined" ? null : (window.faws ?? null);
}

/**
 * On macOS the window is frameless with inset traffic lights, so the header
 * has to leave room for them - but only while they are actually shown, which
 * is to say not in fullscreen.
 *
 * Returns a teardown function; a no-op outside the desktop shell.
 */
export function installTrafficLightInset(): () => void {
  const bridge = desktopBridge();
  const root = document.documentElement;
  if (!bridge || bridge.platform !== "darwin") return () => {};

  root.classList.add("mac-titlebar");
  const unsubscribe = bridge.onFullscreenChange((fullscreen) => {
    root.classList.toggle("mac-titlebar", !fullscreen);
  });

  return () => {
    unsubscribe();
    root.classList.remove("mac-titlebar");
  };
}
