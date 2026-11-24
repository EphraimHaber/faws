/**
 * Keeps the desktop app current from GitHub Releases, or from the folder
 * `feed.ts` resolves when one is configured.
 *
 * Nothing is downloaded until asked: a check says a version exists, and the
 * person decides. On Windows and Linux "Download" fetches it and "Restart"
 * installs it. On macOS the app is unsigned, and Squirrel refuses to replace
 * an unsigned app, so the check still runs but the action opens the release
 * page instead.
 *
 * The window tells this module whether to check on its own (`configure`);
 * with that off the app never contacts its feed unless someone presses "Check".
 */
import type { UpdateConfig, UpdateStatus } from "@faws/contracts";
import { app, shell } from "electron";
import electronUpdater from "electron-updater";

import {
  GITHUB_FEED,
  manualDownloadUrl,
  policyPath,
  readPolicy,
  resolveFeed,
  type Feed,
} from "./feed.ts";

const { autoUpdater } = electronUpdater;

const OWNER = "EphraimHaber";
const REPO = "faws";
const RELEASES = `https://github.com/${OWNER}/${REPO}/releases`;
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
  feedSource: "github",
  feedUrl: null,
};
const listeners = new Set<Listener>();
let timer: NodeJS.Timeout | undefined;
let firstCheck: NodeJS.Timeout | undefined;
let wired = false;
let feed: Feed = GITHUB_FEED;

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
      releaseUrl: feed.url
        ? manualDownloadUrl(feed.url, info.files)
        : `${RELEASES}/tag/v${info.version}`,
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
    await openReleases();
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
  return shell.openExternal(status.releaseUrl ?? feed.url ?? `${RELEASES}/latest`);
}

function sameFeed(a: Feed, b: Feed): boolean {
  return a.url === b.url && JSON.stringify(a.headers) === JSON.stringify(b.headers);
}

/** Points the updater at the feed; a different feed forgets what the last one said. */
function applyFeed(next: Feed): void {
  const changed = !sameFeed(feed, next);
  feed = next;
  if (next.url) {
    autoUpdater.setFeedURL({ provider: "generic", url: next.url });
    autoUpdater.requestHeaders = { ...next.headers };
  } else {
    autoUpdater.setFeedURL({ provider: "github", owner: OWNER, repo: REPO });
    autoUpdater.requestHeaders = null;
  }
  set({
    feedSource: next.source,
    feedUrl: next.url,
    ...(changed
      ? { state: "idle", version: null, releaseNotes: null, releaseUrl: null, error: null }
      : {}),
  });
}

/** Applies the window's preferences: the feed, the channel, and whether to check unasked. */
export function configureUpdates(config: UpdateConfig): void {
  if (app.isPackaged) {
    applyFeed(
      resolveFeed({
        env: process.env,
        policy: readPolicy(policyPath(process.platform, process.env)),
        setting: config.feedUrl,
      }),
    );
  }
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
