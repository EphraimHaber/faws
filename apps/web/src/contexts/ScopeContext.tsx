import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { z } from "zod";

import { readStored, writeStored } from "~/lib/stored";
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
  /** Width in px of the log pane's task-id column. */
  readonly logTaskGutter: number;
  setProfile(next: string): void;
  setRegion(next: string): void;
  setRefreshSeconds(next: number): void;
  setLogTimestamps(next: LogTimestamps): void;
  setLogGutter(next: number): void;
  setLogTaskGutter(next: number): void;
}

const ScopeContext = React.createContext<ScopeValue | null>(null);

const PROFILE_KEY = "faws:profile";
const REGION_KEY = "faws:region";
const REFRESH_KEY = "faws:refresh";
const LOG_TIMESTAMPS_KEY = "faws:logTimestamps";
const LOG_GUTTER_KEY = "faws:logGutter";
const LOG_TASK_GUTTER_KEY = "faws:logTaskGutter";

/** Wide enough for a clock time, which is what the pane opens with. */
export const DEFAULT_LOG_GUTTER = 68;
/** Wide enough for the truncated tail of a task id. */
export const DEFAULT_LOG_TASK_GUTTER = 128;
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

// `z.coerce.number()` turns a missing key into 0, which would sail past a bare
// `int()` and leave a first run refreshing at an interval that isn't even on
// the menu. Checking membership is what makes the `catch` fire.
const storedRefresh = z.coerce
  .number()
  .refine((n) => (REFRESH_CHOICES as readonly number[]).includes(n))
  .catch(30);
const storedLogTimestamps = z.enum(["clock", "full"]).catch("clock");
const storedLogGutter = z.coerce.number().min(MIN_LOG_GUTTER).catch(DEFAULT_LOG_GUTTER);
const storedLogTaskGutter = z.coerce.number().min(MIN_LOG_GUTTER).catch(DEFAULT_LOG_TASK_GUTTER);

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
  const [logTaskGutter, setLogTaskGutterState] = React.useState(() =>
    readStored(LOG_TASK_GUTTER_KEY, storedLogTaskGutter),
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
      logTaskGutter,
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
      setLogTaskGutter: (next) => {
        const clamped = Math.max(MIN_LOG_GUTTER, Math.round(next));
        setLogTaskGutterState(clamped);
        writeStored(LOG_TASK_GUTTER_KEY, String(clamped));
      },
    }),
    [profile, region, refreshSeconds, logTimestamps, logGutter, logTaskGutter, defaultRegion.data],
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
