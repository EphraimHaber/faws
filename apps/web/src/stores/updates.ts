/**
 * The desktop app's update state, mirrored from the main process.
 *
 * Outside the desktop shell there is no bridge and the state says so, which
 * every reader renders as "updates come with the desktop app" rather than as
 * an error.
 */
import type { UpdateStatus } from "@faws/contracts";
import { create } from "zustand";

import { desktopBridge } from "~/lib/desktop";

const BROWSER: UpdateStatus = {
  state: "unsupported",
  currentVersion: import.meta.env.APP_VERSION,
  version: null,
  releaseNotes: null,
  releaseUrl: null,
  progress: null,
  error: null,
  checkedAt: null,
  canInstall: false,
  reason: "Updates come with the desktop app; this is the browser build.",
  feedSource: "github",
  feedUrl: null,
};

export const useUpdates = create<{ status: UpdateStatus }>(() => ({ status: BROWSER }));

let started = false;

/** Subscribes to the main process once; a no-op in the browser build. */
export function initUpdates(): void {
  const bridge = desktopBridge()?.updates;
  if (started || !bridge) return;
  started = true;
  void bridge.status().then((status) => useUpdates.setState({ status }));
  bridge.onStatus((status) => useUpdates.setState({ status }));
}

export const updateActions = {
  check: () => void desktopBridge()?.updates?.check(),
  download: () => void desktopBridge()?.updates?.download(),
  install: () => void desktopBridge()?.updates?.install(),
  openRelease: () => void desktopBridge()?.updates?.openRelease(),
};
