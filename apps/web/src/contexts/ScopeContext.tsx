import {
  DEFAULT_LOG_GUTTER,
  DEFAULT_LOG_TASK_GUTTER,
  type LogTimestamps,
  MIN_LOG_GUTTER,
  REFRESH_CHOICES,
  type S3Scope,
  toS3Scope,
} from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { trpc } from "~/lib/trpc";
import { updateSettings, useSettings } from "~/stores/settings";

/**
 * The AWS scope every query in the app is keyed by.
 *
 * e1s puts profile and region in a footer and switches them with Ctrl+P /
 * Ctrl+R. We keep the same two axes and the same shortcuts, but they live in
 * one context so a switch invalidates every open pane at once instead of
 * leaving stale rows on screen.
 *
 * The values themselves come from `useSettings`, which is to say from the
 * server: the profile you picked in the browser is the profile the desktop app
 * opens on. This context is the adapter that keeps the rest of the app reading
 * one object with one shape, and it is also where the log pane's own
 * preferences hitch a ride, because they are scoped the same way.
 */
export type { LogTimestamps };
export { DEFAULT_LOG_GUTTER, DEFAULT_LOG_TASK_GUTTER, MIN_LOG_GUTTER, REFRESH_CHOICES };

export interface ScopeValue {
  readonly profile: string;
  readonly region: string;
  /** Empty points S3 at AWS; otherwise the id of a saved S3 endpoint. */
  readonly connectionId: string;
  readonly refreshSeconds: number;
  readonly logTimestamps: LogTimestamps;
  /** Width in px of the log pane's leading timestamp column. */
  readonly logGutter: number;
  /** Width in px of the log pane's task-id column. */
  readonly logTaskGutter: number;
  /**
   * False until the stored scope has arrived.
   *
   * Callers that fire an AWS query on mount should wait for it. Before it is
   * true the profile is a guess, and a query keyed on the guess is a request
   * against the wrong account that has to be thrown away a moment later.
   */
  readonly ready: boolean;
  setProfile(next: string): void;
  setRegion(next: string): void;
  setConnectionId(next: string): void;
  setRefreshSeconds(next: number): void;
  setLogTimestamps(next: LogTimestamps): void;
  setLogGutter(next: number): void;
  setLogTaskGutter(next: number): void;
}

const ScopeContext = React.createContext<ScopeValue | null>(null);

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const scope = useSettings((state) => state.settings.scope);
  const logs = useSettings((state) => state.settings.logs);
  const ready = useSettings((state) => state.ready);

  // Until the user picks a region, follow whatever the CLI would use for this
  // profile so the first render isn't empty. Gated on `ready` because an empty
  // region also means "not loaded yet" now, and asking on behalf of a profile
  // we are about to replace would ask twice and be wrong once.
  const defaultRegion = useQuery({
    ...trpc.aws.defaultRegion.queryOptions({ profile: scope.profile }),
    enabled: ready && scope.region.length === 0,
    staleTime: Infinity,
  });

  const value = React.useMemo<ScopeValue>(
    () => ({
      profile: scope.profile,
      region: scope.region || defaultRegion.data || "us-east-1",
      connectionId: scope.connectionId,
      refreshSeconds: scope.refreshSeconds,
      logTimestamps: logs.timestamps,
      logGutter: logs.gutter,
      logTaskGutter: logs.taskGutter,
      ready,
      setProfile: (next) => updateSettings({ scope: { profile: next } }),
      setRegion: (next) => updateSettings({ scope: { region: next } }),
      setConnectionId: (next) => updateSettings({ scope: { connectionId: next } }),
      setRefreshSeconds: (next) => updateSettings({ scope: { refreshSeconds: next } }),
      setLogTimestamps: (next) => updateSettings({ logs: { timestamps: next } }),
      // Clamped here as well as in the schema: the drag handle reports
      // fractional pixels, and a value the schema would reject would come back
      // as the default instead of the narrowest allowed width.
      setLogGutter: (next) => updateSettings({ logs: { gutter: clampGutter(next) } }),
      setLogTaskGutter: (next) => updateSettings({ logs: { taskGutter: clampGutter(next) } }),
    }),
    [scope, logs, ready, defaultRegion.data],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

function clampGutter(value: number): number {
  return Math.max(MIN_LOG_GUTTER, Math.round(value));
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

/**
 * The same pair, plus the endpoint S3 is pointed at.
 *
 * Every S3 query is keyed by this object, so switching to another endpoint
 * invalidates the buckets, the listings and the object in view together rather
 * than leaving one pane showing another storage system's contents.
 */
export function useS3Scope(): S3Scope {
  const { profile, region, connectionId } = useScope();
  return React.useMemo(
    () => toS3Scope({ profile, region, connectionId }),
    [profile, region, connectionId],
  );
}
