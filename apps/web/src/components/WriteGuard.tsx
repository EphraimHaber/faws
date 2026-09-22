import type * as React from "react";

import { useWriteMode, type WriteNeed } from "~/hooks/useWriteMode";

/** Why this kind of operation is refused right now, or null if it is allowed. */
export function useDisabledReason(need: WriteNeed): string | null {
  return useWriteMode().reasonFor(need);
}

/**
 * Renders a control that knows why it cannot be used.
 *
 * The app used to answer read-only mode by *hiding* mutating controls. That is
 * tidy and it teaches nothing: a delete button that is absent and a delete
 * button this build does not have look identical, so the mode people are in is
 * invisible until they go looking in Settings for something they cannot find.
 * A disabled control with a reason on it says what is true and what to do about
 * it, in the place where the question came up.
 *
 * A render prop rather than a wrapper element, so it composes with `Button`
 * without putting a node between it and its flex parent.
 *
 * Note the reason belongs on a wrapping element, not on the disabled control
 * itself: `Button` sets `disabled:pointer-events-none`, so a `title` on the
 * button would never be shown. `DisabledHint` does that wrapping.
 */
export function WriteGuard({
  need,
  children,
}: {
  need: WriteNeed;
  children: (state: { disabled: boolean; reason: string | null }) => React.ReactNode;
}): React.ReactNode {
  const reason = useDisabledReason(need);
  return children({ disabled: reason !== null, reason });
}

/**
 * Wraps a control so a refusal has somewhere to hang its explanation.
 *
 * `inline-flex` rather than a block, because every caller puts this where a
 * button already sat in a row of them.
 */
export function DisabledHint({
  reason,
  children,
}: {
  reason: string | null;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex" {...(reason ? { title: reason } : {})}>
      {children}
    </span>
  );
}
