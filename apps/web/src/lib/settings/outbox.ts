/**
 * The changes this window has made that the server has not confirmed yet.
 *
 * Writes are optimistic, so what is on screen runs ahead of the server. A
 * snapshot that arrives in that gap - the first load, or another window's
 * broadcast - describes the server before those changes, and applying it as
 * it stands would take them back off the screen. The server still applies
 * them, but its answer is our own echo and is not applied, so the screen
 * would stay wrong until a reload. `show` lays the unconfirmed changes back
 * over any snapshot before it reaches the screen.
 */
import { applyPatch, type Settings, type SettingsPatch } from "@faws/contracts";

import { isEmptyPatch, mergePatches } from "./merge.ts";

export interface Outbox {
  /** Adds a change that has not been sent yet. */
  queue(patch: SettingsPatch): void;
  /** Moves everything queued into flight, or answers null if there is nothing to send. */
  take(): { readonly id: number; readonly patch: SettingsPatch } | null;
  /**
   * Drops a sent change, once the server has answered for it either way.
   *
   * A failure settles too: the server is re-read on reconnect, and a change
   * held forever would sit over every snapshot after it.
   */
  settle(id: number): void;
  /** Settings as the snapshot has them, with every unconfirmed change on top. */
  show(settings: Settings): Settings;
}

export function createOutbox(): Outbox {
  let pending: SettingsPatch = {};
  // Kept one per send, in order, rather than merged: an answer settles only
  // its own change, and a later one still in flight must stay on screen.
  const inFlight = new Map<number, SettingsPatch>();
  let nextId = 1;

  const unconfirmed = (): SettingsPatch => [...inFlight.values(), pending].reduce(mergePatches, {});

  return {
    queue(patch) {
      pending = mergePatches(pending, patch);
    },
    take() {
      if (isEmptyPatch(pending)) return null;
      const sent = { id: nextId++, patch: pending };
      inFlight.set(sent.id, sent.patch);
      pending = {};
      return sent;
    },
    settle(id) {
      inFlight.delete(id);
    },
    show(settings) {
      const overlay = unconfirmed();
      return isEmptyPatch(overlay) ? settings : applyPatch(settings, overlay);
    },
  };
}
