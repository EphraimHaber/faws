import type { EcsService, EcsTask, SilencedSettings, SilenceEntry } from "@faws/contracts";

import { applySilence, useSettings } from "./settings";

/**
 * Warnings the operator has chosen not to see.
 *
 * Two deliberately different mechanisms, because "not mine" and "already dealt
 * with" are different problems:
 *
 * - **Dismiss** is scoped to one *instance* of a failure via a fingerprint.
 *   If the service fails again in a new way — another task dies, a new rollout
 *   fails — the fingerprint changes and the warning comes back. Dismissing can
 *   never hide a fresh incident.
 * - **Mute** is scoped to the resource and lasts until it is lifted. That is
 *   the right tool for another team's service in a shared account, where the
 *   failures are real, recurring, and not yours to act on.
 *
 * Both are per-ARN, so they are implicitly scoped to an account and region.
 * Nothing is hidden silently: every surface that filters shows how many it
 * hid, and Settings lists every entry with a way to restore it.
 *
 * The list lives on the server. A mute list is the product of real
 * operational knowledge about which alarms are somebody else's, and keeping it
 * in `localStorage` meant it did not follow the person from the browser to the
 * desktop app and vanished with a browser-data clear.
 */
export type { SilenceEntry };

interface SilencedActions {
  dismiss(entry: Omit<SilenceEntry, "at">): void;
  mute(entry: Omit<SilenceEntry, "at" | "fingerprint">): void;
  restore(arn: string): void;
  restoreAll(): void;
}

const actions: SilencedActions = {
  dismiss: (entry) => applySilence({ op: "dismiss", entry }),
  mute: (entry) => applySilence({ op: "mute", entry }),
  restore: (arn) => applySilence({ op: "restore", arn }),
  restoreAll: () => applySilence({ op: "restoreAll" }),
};

type SilencedState = SilencedSettings & SilencedActions;

/**
 * Kept as a selector hook with the shape callers already use, so the change of
 * where these live did not ripple through every menu and page that reads them.
 */
export function useSilenced<T>(selector: (state: SilencedState) => T): T {
  return useSettings((state) => selector({ ...state.settings.silenced, ...actions }));
}

/**
 * Identity of a service's *current* failure state.
 *
 * Every component of this is something an operator would want to be told
 * about again: a different rollout, a different outcome, one more failed task.
 */
export function serviceFingerprint(service: EcsService): string {
  return [
    service.rolloutState ?? "none",
    service.deploymentState,
    service.failedTasks,
    service.lastDeploymentAt ?? "never",
  ].join("|");
}

/** A stopped task is immutable once stopped, so its ARN is fingerprint enough. */
export function taskFingerprint(task: EcsTask): string {
  return `${task.lastStatus}|${task.stoppedAt ?? ""}`;
}

export interface SilenceCheck {
  readonly silenced: boolean;
  readonly reason: "muted" | "dismissed" | null;
}

export function checkSilence(
  state: SilencedSettings,
  arn: string,
  fingerprint: string,
): SilenceCheck {
  if (state.muted[arn]) return { silenced: true, reason: "muted" };
  const dismissal = state.dismissed[arn];
  if (dismissal && dismissal.fingerprint === fingerprint) {
    return { silenced: true, reason: "dismissed" };
  }
  return { silenced: false, reason: null };
}

/** Hook form for the common case: "should this service's warning show?" */
export function useServiceSilence(service: EcsService): SilenceCheck {
  const silenced = useSettings((state) => state.settings.silenced);
  return checkSilence(silenced, service.arn, serviceFingerprint(service));
}

/** Partitions services into those still worth showing and those silenced. */
export function partitionSilenced(
  state: SilencedSettings,
  services: ReadonlyArray<EcsService>,
): { visible: EcsService[]; hidden: EcsService[] } {
  const visible: EcsService[] = [];
  const hidden: EcsService[] = [];
  for (const service of services) {
    const check = checkSilence(state, service.arn, serviceFingerprint(service));
    (check.silenced ? hidden : visible).push(service);
  }
  return { visible, hidden };
}
