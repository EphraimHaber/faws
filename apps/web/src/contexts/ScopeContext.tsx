import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { trpc } from "~/lib/trpc";

/**
 * The AWS scope every query in the app is keyed by.
 *
 * e1s puts profile and region in a footer and switches them with Ctrl+P /
 * Ctrl+R. We keep the same two axes and the same shortcuts, but they live in
 * one context so a switch invalidates every open pane at once instead of
 * leaving stale rows on screen.
 */
export interface ScopeValue {
  readonly profile: string;
  readonly region: string;
  readonly refreshSeconds: number;
  setProfile(next: string): void;
  setRegion(next: string): void;
  setRefreshSeconds(next: number): void;
}

const ScopeContext = React.createContext<ScopeValue | null>(null);

const PROFILE_KEY = "faws:profile";
const REGION_KEY = "faws:region";
const REFRESH_KEY = "faws:refresh";

/** -1 means "never auto-refresh", matching e1s's `--refresh -1`. */
export const REFRESH_CHOICES = [-1, 10, 30, 60, 300] as const;

function readStored(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / blocked storage - the session still works */
  }
}

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfileState] = React.useState(() => readStored(PROFILE_KEY, "default"));
  const [region, setRegionState] = React.useState(() => readStored(REGION_KEY, ""));
  const [refreshSeconds, setRefreshSecondsState] = React.useState(() =>
    Number(readStored(REFRESH_KEY, "30")),
  );

  // Until the user picks a region, follow whatever the CLI would use for this
  // profile so the first render isn't empty.
  const defaultRegion = useQuery({
    ...trpc.aws.defaultRegion.queryOptions({ profile }),
    enabled: region.length === 0,
    staleTime: Infinity,
  });

  const value = React.useMemo<ScopeValue>(
    () => ({
      profile,
      region: region || defaultRegion.data || "us-east-1",
      refreshSeconds,
      setProfile: (next) => {
        setProfileState(next);
        writeStored(PROFILE_KEY, next);
      },
      setRegion: (next) => {
        setRegionState(next);
        writeStored(REGION_KEY, next);
      },
      setRefreshSeconds: (next) => {
        setRefreshSecondsState(next);
        writeStored(REFRESH_KEY, String(next));
      },
    }),
    [profile, region, refreshSeconds, defaultRegion.data],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeValue {
  const value = React.useContext(ScopeContext);
  if (!value) throw new Error("useScope must be used inside <ScopeProvider>");
  return value;
}

/** The `{ profile, region }` pair every ECS procedure takes as input. */
export function useAwsScope(): { profile: string; region: string } {
  const { profile, region } = useScope();
  return React.useMemo(() => ({ profile, region }), [profile, region]);
}
