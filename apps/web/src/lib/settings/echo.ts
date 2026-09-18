/**
 * Deciding what to do with an incoming settings snapshot.
 *
 * Two independent reasons not to overwrite what is on screen, and they catch
 * different bugs:
 *
 * - **It is our own echo.** This window applied the change optimistically
 *   before it sent it, so re-applying it can only cause a flicker.
 * - **It is stale.** Settings are written from a `pointermove` handler, so
 *   update N's response can land after N+2 has already been applied locally.
 *   Applying it snaps the dragged column backwards under the cursor.
 *
 * The decision and the watermark are one function on purpose. Dropping an own
 * echo *without* advancing the watermark is the subtle version of this bug: a
 * window would keep a revision of 0 through a whole drag, and then accept the
 * next broadcast from another window even though that broadcast predates its
 * own last change and would roll it back.
 */
export interface Incoming {
  readonly revision: number;
  /** Null for a change no window caused, such as a write failing. */
  readonly originId?: string | null;
}

export interface ApplyState {
  /** Highest revision this window has heard about, applied or not. */
  readonly revision: number;
  readonly originId: string;
}

export interface Verdict {
  /** Whether to replace the settings currently on screen. */
  readonly apply: boolean;
  /** The new watermark. Always store this, whatever `apply` says. */
  readonly revision: number;
}

export function reconcile(incoming: Incoming, state: ApplyState): Verdict {
  const revision = Math.max(state.revision, incoming.revision);
  if (incoming.revision <= state.revision) return { apply: false, revision };
  if (incoming.originId === state.originId) return { apply: false, revision };
  return { apply: true, revision };
}
