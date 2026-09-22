import * as React from "react";

import { useSearchState } from "~/hooks/useSearchState";

/**
 * The open tab, kept in the URL rather than in component state.
 *
 * A screen's tabs are most of what "where am I?" means on that screen, so a
 * reload, a bookmark or a pasted link should land on the same one. The default
 * tab is the absent param, which keeps the plain URL clean, and switching
 * replaces the history entry — the tabs are one page, not a trail.
 *
 * An unknown or no-longer-available tab falls back rather than showing
 * nothing: links outlive the tab lists they were written against.
 *
 * Both of those rules now belong to `useSearchState`, which every other piece
 * of URL-held page state follows too; this hook is the tab-shaped reading of
 * them.
 */
export function useTabSearch<T extends string>(
  tabs: readonly T[],
  fallback: T,
): readonly [T, (next: T) => void] {
  const parse = React.useCallback(
    (raw: unknown): T => tabs.find((candidate) => candidate === raw) ?? fallback,
    [tabs, fallback],
  );

  return useSearchState<T>({ key: "tab", fallback, parse });
}
