/**
 * The renderer's view of the settings the server owns.
 *
 * A zustand store rather than a React context, for two reasons that both come
 * from what actually reads these values. A context re-renders everything below
 * the provider on every change, and `logs.gutter` changes on every
 * `pointermove` of a drag - selectors are what keep that to the one pane that
 * cares. And `sessions.ts` reads `terminal.recordByDefault` outside React, at
 * handshake time, which a context cannot serve at all.
 *
 * Writes are optimistic: local state changes immediately, then a debounced,
 * coalesced patch goes to the server. Nothing in the UI waits on a round trip
 * to show the change the person just made, and the server's answer is ignored
 * as an echo of what is already on screen.
 */
import {
  applyPatch,
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch,
  type SettingsPersistence,
  type RecentOp,
  type SettingsSnapshot,
  type SilenceOp,
} from "@faws/contracts";
import { create } from "zustand";

import { seedSettings, writeCache } from "~/lib/settings/cache";
import { clearLegacyKeys, collectLegacySettings } from "~/lib/settings/importLegacy";
import { reconcile } from "~/lib/settings/echo";
import { isEmptyPatch, mergePatches } from "~/lib/settings/merge";
import { getSocket } from "~/lib/socket";
import { trpcClient } from "~/lib/trpc";

/**
 * This window's identity, minted once per page load.
 *
 * Not `socket.id`: that is unknown until the socket connects and changes on
 * every reconnect, so a write sent during a blip would come back looking like
 * somebody else's.
 */
const ORIGIN_ID =
  globalThis.crypto?.randomUUID?.() ?? `w-${Math.random().toString(36).slice(2)}-${Date.now()}`;

/** Matches the server's write debounce; one round trip per drag-second. */
const SEND_DEBOUNCE_MS = 150;

interface SettingsState {
  readonly settings: Settings;
  /**
   * False until the server has answered once.
   *
   * It gates *queries*, not paint: `scope.region` being empty means "ask the
   * CLI for this profile's default", and firing that question against a
   * profile we have not loaded yet would ask it twice and about the wrong
   * profile the first time.
   */
  readonly ready: boolean;
  readonly revision: number;
  readonly persistence: SettingsPersistence;
}

export const useSettings = create<SettingsState>(() => ({
  settings: seedSettings(),
  ready: false,
  revision: 0,
  persistence: { writable: true, reason: null },
}));

/** For the handful of readers that are not React components. */
export function settingsSnapshot(): Settings {
  return useSettings.getState().settings;
}

/**
 * Applies a server snapshot unless it is our own echo or arrived out of order.
 *
 * "Our own echo" means a change this window already applied optimistically,
 * which is only ever `updateSettings`. Everything else deliberately passes
 * `null`: those changes were *not* applied locally first, so suppressing the
 * echo would suppress the only copy of them this window will ever see - and
 * the watermark would then drop the response too, for arriving second.
 */
function accept(snapshot: SettingsSnapshot, originId: string | null): void {
  const state = useSettings.getState();
  const verdict = reconcile(
    { revision: snapshot.revision, originId },
    {
      revision: state.revision,
      originId: ORIGIN_ID,
    },
  );

  useSettings.setState({
    revision: verdict.revision,
    ready: true,
    persistence: snapshot.persistence,
    ...(verdict.apply ? { settings: snapshot.settings } : {}),
  });
  if (verdict.apply) writeCache(snapshot.settings);
}

let pending: SettingsPatch = {};
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Changes one or more preferences.
 *
 * The local state moves first and the patch is merged into whatever has not
 * been sent yet, so a drag is one request per debounce window rather than one
 * per frame.
 */
export function updateSettings(patch: SettingsPatch): void {
  const next = applyPatch(useSettings.getState().settings, patch);
  useSettings.setState({ settings: next });
  writeCache(next);

  pending = mergePatches(pending, patch);
  if (timer) clearTimeout(timer);
  timer = setTimeout(sendPending, SEND_DEBOUNCE_MS);
}

function sendPending(): void {
  timer = null;
  const patch = pending;
  pending = {};
  if (isEmptyPatch(patch)) return;
  void trpcClient.settings.update
    .mutate({ patch, originId: ORIGIN_ID })
    .then((snapshot) => accept(snapshot, ORIGIN_ID))
    .catch(() => {
      // The server is the source of truth and will be re-read on reconnect;
      // rolling the UI back here would fight the person's own input.
    });
}

/**
 * Silences or restores a warning.
 *
 * Not debounced: these are discrete, deliberate acts a few seconds apart, and
 * the maps are keyed by ARN so there is nothing to coalesce.
 *
 * No `originId`, for the reason set out above `accept`: the local state is not
 * moved first, so `at` can come from the server's clock rather than being
 * guessed here and shifting under the person a moment later.
 */
export function applySilence(op: SilenceOp): void {
  void trpcClient.settings.silence
    .mutate({ op })
    .then((snapshot) => accept(snapshot, null))
    .catch(() => undefined);
}

/**
 * Records, pins, unpins or forgets a resource.
 *
 * Shaped exactly like `applySilence` above, and for the same reasons: discrete
 * acts with nothing to coalesce, and no `originId`, so `at` is the server's
 * clock rather than this window's. That matters more here than it does for a
 * mute - `at` is what the recent list is *sorted by*, so a browser with a
 * skewed clock would otherwise pin its own rows to the top of the list on
 * every other machine.
 */
export function applyRecent(op: RecentOp): void {
  void trpcClient.settings.recents
    .mutate({ op })
    .then((snapshot) => accept(snapshot, null))
    .catch(() => undefined);
}

/** Puts every preference back to its default, for everyone. */
export function resetSettings(): void {
  void trpcClient.settings.reset
    .mutate({})
    .then((snapshot) => accept(snapshot, null))
    .catch(() => undefined);
}

/**
 * Hands this browser's old `localStorage` preferences to the server, once.
 *
 * Gated on the server's `pristine` flag rather than on a local tombstone: a
 * second browser profile on the same machine would otherwise turn up weeks
 * later and import its stale values over a settings file that is by then the
 * real one. The server refuses a second import anyway, so two tabs racing on
 * first load costs nothing.
 */
function importLegacySettings(): void {
  const legacy = collectLegacySettings();
  if (!legacy) return;
  void trpcClient.settings.importLegacy
    .mutate({ patch: legacy.patch, silenced: legacy.silenced })
    .then((result) => {
      // Clear only on a real import: if the server had settings already, this
      // browser's copy is the stale one and worth keeping until it is stale
      // beyond doubt.
      if (!result.imported) return;
      accept(result.snapshot, null);
      clearLegacyKeys(legacy.keys);
    })
    .catch(() => undefined);
}

let started = false;

/**
 * Fetches settings and subscribes to changes from other windows.
 *
 * Run at module load rather than from an effect: StrictMode double-mounts, and
 * the fetch wants to be in flight before React renders anyway. The refetch on
 * `connect` covers a window that was disconnected while another one changed
 * something - a reconnect and an update look identical to `accept`.
 */
export function initSettings(): void {
  if (started) return;
  started = true;

  let first = true;
  const load = () => {
    void trpcClient.settings.get
      .query()
      .then((snapshot) => {
        accept(snapshot, null);
        if (first) {
          first = false;
          if (snapshot.pristine) importLegacySettings();
        }
      })
      .catch(() => {
        // In dev, Vite serves this page before the server is listening. The
        // seeded values are already on screen; the socket's `connect` will
        // bring the real ones as soon as there is something to connect to.
        useSettings.setState({ ready: true });
      });
  };

  load();
  const socket = getSocket();
  socket.on("connect", load);
  socket.on("settings:changed", (payload) => accept(payload, payload.originId));
}

export { DEFAULT_SETTINGS, ORIGIN_ID };
