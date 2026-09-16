import type { EcsService, EcsTask } from "@faws/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";

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
 */
export interface SilenceEntry {
  readonly arn: string;
  readonly label: string;
  readonly context: string;
  /** Present for dismissals; absent for mutes. */
  readonly fingerprint?: string;
  readonly at: string;
}

interface SilencedState {
  readonly dismissed: Record<string, SilenceEntry>;
  readonly muted: Record<string, SilenceEntry>;
  dismiss(entry: Omit<SilenceEntry, "at">): void;
  mute(entry: Omit<SilenceEntry, "at" | "fingerprint">): void;
  restore(arn: string): void;
  restoreAll(): void;
}

export const useSilenced = create<SilencedState>()(
  persist(
    (set) => ({
      dismissed: {},
      muted: {},
      dismiss: (entry) =>
        set((state) => ({
          dismissed: {
            ...state.dismissed,
            [entry.arn]: { ...entry, at: new Date().toISOString() },
          },
        })),
      mute: (entry) =>
        set((state) => ({
          muted: { ...state.muted, [entry.arn]: { ...entry, at: new Date().toISOString() } },
        })),
      restore: (arn) =>
        set((state) => {
          const { [arn]: _dismissed, ...dismissed } = state.dismissed;
          const { [arn]: _muted, ...muted } = state.muted;
          return { dismissed, muted };
        }),
      restoreAll: () => set({ dismissed: {}, muted: {} }),
    }),
    { name: "faws:silenced" },
  ),
);

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
  state: Pick<SilencedState, "dismissed" | "muted">,
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
  const dismissed = useSilenced((state) => state.dismissed);
  const muted = useSilenced((state) => state.muted);
  return checkSilence({ dismissed, muted }, service.arn, serviceFingerprint(service));
}

/** Partitions services into those still worth showing and those silenced. */
export function partitionSilenced(
  state: Pick<SilencedState, "dismissed" | "muted">,
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
