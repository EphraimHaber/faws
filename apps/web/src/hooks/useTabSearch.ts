import { useNavigate, useSearch } from "@tanstack/react-router";
import * as React from "react";

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
 */
export function useTabSearch<T extends string>(
  tabs: readonly T[],
  fallback: T,
): readonly [T, (next: T) => void] {
  const navigate = useNavigate();
  const search: { tab?: string } = useSearch({ strict: false });
  const raw = search.tab;
  const tab = tabs.find((candidate) => candidate === raw) ?? fallback;

  const setTab = React.useCallback(
    (next: T) => {
      void navigate({
        to: ".",
        search: ((prev: { tab?: string }) => {
          const { tab: _current, ...rest } = prev;
          return next === fallback ? rest : { ...rest, tab: next };
        }) as never,
        replace: true,
      });
    },
    [navigate, fallback],
  );

  return [tab, setTab] as const;
}
