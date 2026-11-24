/**
 * Keeps the desktop app current from GitHub Releases.
 *
 * Nothing is downloaded until asked: a check says a version exists, and the
 * person decides. On Windows and Linux "Download" fetches it and "Restart"
 * installs it. On macOS the app is unsigned, and Squirrel refuses to replace
 * an unsigned app, so the check still runs but the action opens the release
 * page instead.
 *
 * The window tells this module whether to check on its own (`configure`);
 * with that off the app never contacts GitHub unless someone presses "Check".
 */
import type { UpdateConfig, UpdateStatus } from "@faws/contracts";
import { app, shell } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

const RELEASES = "https://github.com/EphraimHaber/faws/releases";
/** Often enough that a fix reaches a long-running window within the day. */
const AUTO_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** Long enough after launch not to compete with the first screen's requests. */
const FIRST_CHECK_AFTER_MS = 30 * 1000;

type Listener = (status: UpdateStatus) => void;

const canInstall = process.platform !== "darwin";

let status: UpdateStatus = {
  state: "idle",
  currentVersion: app.getVersion(),
  version: null,
  releaseNotes: null,
  releaseUrl: null,
  progress: null,
  error: null,
  checkedAt: null,
  canInstall,
  reason: null,
};
const listeners = new Set<Listener>();
let timer: NodeJS.Timeout | undefined;
let firstCheck: NodeJS.Timeout | undefined;
let wired = false;

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener(status);
}

export function updateStatus(): UpdateStatus {
  return status;
}

export function onUpdateStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function supported(): boolean {
  if (app.isPackaged) return true;
  set({ state: "unsupported", reason: "This is a development build; it does not update itself." });
  return false;
}

function wire(): void {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => set({ state: "checking", error: null }));
  autoUpdater.on("update-not-available", () =>
    set({ state: "up-to-date", checkedAt: new Date().toISOString(), version: null }),
  );
  autoUpdater.on("update-available", (info) =>
    set({
      state: "available",
      checkedAt: new Date().toISOString(),
      version: info.version,
      releaseNotes: notesOf(info.releaseNotes),
      releaseUrl: `${RELEASES}/tag/v${info.version}`,
    }),
  );
  autoUpdater.on("download-progress", (progress) =>
    set({ state: "downloading", progress: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", () => set({ state: "ready", progress: 100 }));
  autoUpdater.on("error", (error: Error) =>
    set({ state: "error", error: error.message, checkedAt: new Date().toISOString() }),
  );
}

function notesOf(notes: unknown): string | null {
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) {
    return notes
      .map((entry: { version?: string; note?: string | null }) =>
        entry.note ? `## ${entry.version ?? ""}\n\n${entry.note}` : "",
      )
      .filter(Boolean)
      .join("\n\n");
  }
  return null;
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!supported()) return status;
  wire();
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    set({ state: "error", error: error instanceof Error ? error.message : String(error) });
  }
  return status;
}

/** Downloads where the platform can install in place; opens the release page where not. */
export async function downloadUpdate(): Promise<void> {
  if (!canInstall) {
    await shell.openExternal(status.releaseUrl ?? `${RELEASES}/latest`);
    return;
  }
  if (!supported()) return;
  wire();
  set({ state: "downloading", progress: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    set({ state: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

export function installUpdate(): void {
  if (status.state === "ready") autoUpdater.quitAndInstall();
}

export function openReleases(): Promise<void> {
  return shell.openExternal(status.releaseUrl ?? `${RELEASES}/latest`);
}

/** Applies the window's preferences: the channel, and whether to check unasked. */
export function configureUpdates(config: UpdateConfig): void {
  autoUpdater.allowPrerelease = config.channel === "beta";
  autoUpdater.channel = config.channel === "beta" ? "beta" : "latest";
  clearTimeout(firstCheck);
  clearInterval(timer);
  firstCheck = undefined;
  timer = undefined;
  if (!config.autoCheck || !app.isPackaged) return;
  firstCheck = setTimeout(() => void checkForUpdates(), FIRST_CHECK_AFTER_MS);
  timer = setInterval(() => void checkForUpdates(), AUTO_CHECK_EVERY_MS);
}
