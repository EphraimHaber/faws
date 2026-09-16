import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { z } from "zod";

import { trpc } from "~/lib/trpc";

/**
 * The AWS scope every query in the app is keyed by.
 *
 * e1s puts profile and region in a footer and switches them with Ctrl+P /
 * Ctrl+R. We keep the same two axes and the same shortcuts, but they live in
 * one context so a switch invalidates every open pane at once instead of
 * leaving stale rows on screen.
 */
/** Clock time is enough to follow a tail; the full stamp is what you paste
 *  into a ticket or line up against another system's clock. */
export type LogTimestamps = "clock" | "full";

export interface ScopeValue {
  readonly profile: string;
  readonly region: string;
  readonly refreshSeconds: number;
  readonly logTimestamps: LogTimestamps;
  /** Width in px of the log pane's leading timestamp column. */
  readonly logGutter: number;
  setProfile(next: string): void;
  setRegion(next: string): void;
  setRefreshSeconds(next: number): void;
  setLogTimestamps(next: LogTimestamps): void;
  setLogGutter(next: number): void;
}

const ScopeContext = React.createContext<ScopeValue | null>(null);

const PROFILE_KEY = "faws:profile";
const REGION_KEY = "faws:region";
const REFRESH_KEY = "faws:refresh";
const LOG_TIMESTAMPS_KEY = "faws:logTimestamps";
const LOG_GUTTER_KEY = "faws:logGutter";

/** Wide enough for a clock time, which is what the pane opens with. */
export const DEFAULT_LOG_GUTTER = 68;
/** Narrower than this and the column is a stripe, not a timestamp. */
export const MIN_LOG_GUTTER = 36;

/** -1 means "never auto-refresh", matching e1s's `--refresh -1`. */
export const REFRESH_CHOICES = [-1, 10, 30, 60, 300] as const;

/**
 * Stored preferences are parsed, not trusted: localStorage outlives the code
 * that wrote it, and the user can edit it. Every schema below `catch`es, so a
 * value this version no longer understands falls back to the default instead
 * of failing the render that reads it.
 */
const storedProfile = z.string().min(1).catch("default");
const storedRegion = z.string().catch("");
const storedRefresh = z.coerce.number().int().catch(30);
const storedLogTimestamps = z.enum(["clock", "full"]).catch("clock");
const storedLogGutter = z.coerce.number().min(MIN_LOG_GUTTER).catch(DEFAULT_LOG_GUTTER);

function readStored<T>(key: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(window.localStorage.getItem(key));
  } catch {
    // Blocked storage: the schema's own fallback is still the right answer.
    return schema.parse(null);
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
  const [profile, setProfileState] = React.useState(() => readStored(PROFILE_KEY, storedProfile));
  const [region, setRegionState] = React.useState(() => readStored(REGION_KEY, storedRegion));
  const [refreshSeconds, setRefreshSecondsState] = React.useState(() =>
    readStored(REFRESH_KEY, storedRefresh),
  );
  const [logTimestamps, setLogTimestampsState] = React.useState<LogTimestamps>(() =>
    readStored(LOG_TIMESTAMPS_KEY, storedLogTimestamps),
  );
  const [logGutter, setLogGutterState] = React.useState(() =>
    readStored(LOG_GUTTER_KEY, storedLogGutter),
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
      logTimestamps,
      logGutter,
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
      setLogTimestamps: (next) => {
        setLogTimestampsState(next);
        writeStored(LOG_TIMESTAMPS_KEY, next);
      },
      setLogGutter: (next) => {
        const clamped = Math.max(MIN_LOG_GUTTER, Math.round(next));
        setLogGutterState(clamped);
        writeStored(LOG_GUTTER_KEY, String(clamped));
      },
    }),
    [profile, region, refreshSeconds, logTimestamps, logGutter, defaultRegion.data],
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
