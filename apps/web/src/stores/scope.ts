/**
 * Where each provider is pointed, and whether it is on at all.
 *
 * Read straight from the settings store with selectors rather than through a
 * React context: a context re-renders every consumer on any change, and the
 * log pane's gutter is in the same store and changes on every `pointermove` of
 * a drag. Each hook here subscribes to exactly the fields it returns.
 *
 * The values come from the server, so the profile picked in the browser is the
 * profile the desktop app opens on.
 */
import {
  type AwsScopeSettings,
  DEFAULT_LOG_GUTTER,
  DEFAULT_LOG_TASK_GUTTER,
  type KubeScopeSettings,
  type LogTimestamps,
  MIN_LOG_GUTTER,
  type ProviderId,
  REFRESH_CHOICES,
  type S3Scope,
  toS3Scope,
} from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useShallow } from "zustand/react/shallow";

import { trpc } from "~/lib/trpc";
import { updateSettings, useSettings } from "~/stores/settings";

export type { LogTimestamps };
export { DEFAULT_LOG_GUTTER, DEFAULT_LOG_TASK_GUTTER, MIN_LOG_GUTTER, REFRESH_CHOICES };

// ---------------------------------------------------------------------------
// Providers on and off

export function useProviderEnabled(id: ProviderId): boolean {
  return useSettings((state) => state.settings.providers[id].enabled);
}

/** The ids of every provider that is on, in a stable order. */
export function useEnabledProviders(): ReadonlyArray<ProviderId> {
  return useSettings(
    useShallow((state) =>
      (Object.keys(state.settings.providers) as ProviderId[]).filter(
        (id) => state.settings.providers[id].enabled,
      ),
    ),
  );
}

export function setProviderEnabled(id: ProviderId, enabled: boolean): void {
  updateSettings({ providers: { [id]: { enabled } } });
}

// ---------------------------------------------------------------------------
// AWS

/**
 * The account and region the AWS pages are looking at.
 *
 * Until someone picks a region, it follows whatever the CLI would use for the
 * profile, so the first render is not empty. That question is only asked once
 * settings have loaded - an empty region also means "not loaded yet", and
 * asking on behalf of a profile about to be replaced would ask twice and be
 * wrong once - and never while AWS is switched off.
 */
function useResolvedAwsScope(): AwsScopeSettings & { ready: boolean } {
  const stored = useSettings((state) => state.settings.providers.aws.scope);
  const enabled = useProviderEnabled("aws");
  const ready = useSettings((state) => state.ready);
  const defaultRegion = useQuery({
    ...trpc.aws.defaultRegion.queryOptions({ profile: stored.profile }),
    enabled: enabled && ready && stored.region.length === 0,
    staleTime: Infinity,
  });
  const region = stored.region || defaultRegion.data || "us-east-1";
  return React.useMemo(
    () => ({ profile: stored.profile, region, ready }),
    [stored.profile, region, ready],
  );
}

/** The `{ profile, region }` pair every AWS procedure takes as input. */
export function useAwsScope(): { profile: string; region: string } {
  const { profile, region } = useResolvedAwsScope();
  return React.useMemo(() => ({ profile, region }), [profile, region]);
}

export function setAwsProfile(profile: string): void {
  updateSettings({ providers: { aws: { scope: { profile } } } });
}

export function setAwsRegion(region: string): void {
  updateSettings({ providers: { aws: { scope: { region } } } });
}

// ---------------------------------------------------------------------------
// S3

/**
 * The AWS pair plus the endpoint S3 is pointed at.
 *
 * Every S3 query is keyed by this object, so switching to another endpoint
 * invalidates the buckets, the listings and the object in view together rather
 * than leaving one pane showing another storage system's contents.
 */
export function useS3Scope(): S3Scope {
  const { profile, region } = useAwsScope();
  const connectionId = useSettings((state) => state.settings.providers.s3.scope.connectionId);
  return React.useMemo(
    () => toS3Scope({ profile, region, connectionId }),
    [profile, region, connectionId],
  );
}

export function setS3ConnectionId(connectionId: string): void {
  updateSettings({ providers: { s3: { scope: { connectionId } } } });
}

// ---------------------------------------------------------------------------
// Kubernetes

export interface KubeScopeValue {
  readonly context: string;
  readonly namespace: string;
  /** False until the kubeconfig has answered and there is a context to use. */
  readonly ready: boolean;
  setContext(next: string): void;
  setNamespace(next: string): void;
}

/**
 * Which context and namespace the Kubernetes pages are looking at.
 *
 * The fallbacks matter more than the storage. Nothing is stored until someone
 * picks something, so an empty setting means "whatever `kubectl` would do":
 * the kubeconfig's `current-context`, then that context's own namespace, then
 * `default`. Copying those into the settings file on first load would have
 * frozen them, and `kubectl config use-context` in the window next door would
 * then quietly stop moving this app.
 */
export function useKubeScope(): KubeScopeValue {
  const stored = useSettings((state) => state.settings.providers.kubernetes.scope);
  const enabled = useProviderEnabled("kubernetes");
  const contexts = useQuery({
    ...trpc.kube.contexts.queryOptions(),
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  return React.useMemo(() => {
    const known = contexts.data ?? [];
    const current = known.find((entry) => entry.current)?.name ?? known[0]?.name ?? "";
    const context = stored.context || current;
    const namespace =
      stored.namespace || known.find((entry) => entry.name === context)?.namespace || "default";
    return {
      context,
      namespace,
      ready: context.length > 0,
      setContext: setKubeContext,
      setNamespace: setKubeNamespace,
    };
  }, [stored, contexts.data]);
}

/**
 * Switching context clears the namespace, because a namespace belongs to the
 * context it was chosen in: carrying `payments` across to one that has no such
 * namespace would leave every list empty and correct.
 */
export function setKubeContext(context: string): void {
  updateSettings({ providers: { kubernetes: { scope: { context, namespace: "" } } } });
}

export function setKubeNamespace(namespace: string): void {
  updateSettings({ providers: { kubernetes: { scope: { namespace } } } });
}

/** Points the Kubernetes pages at a context and namespace in one write. */
export function setKubeScope(scope: KubeScopeSettings): void {
  updateSettings({ providers: { kubernetes: { scope } } });
}

// ---------------------------------------------------------------------------
// The combined view older pages read

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

/**
 * Everything at once. Prefer the narrower hooks above in new code: this one
 * re-renders on a log gutter drag, which a pane that only needs the region
 * should not.
 */
export function useScope(): ScopeValue {
  const { profile, region, ready } = useResolvedAwsScope();
  const connectionId = useSettings((state) => state.settings.providers.s3.scope.connectionId);
  const refreshSeconds = useRefreshSeconds();
  const logs = useSettings((state) => state.settings.logs);

  return React.useMemo<ScopeValue>(
    () => ({
      profile,
      region,
      connectionId,
      refreshSeconds,
      logTimestamps: logs.timestamps,
      logGutter: logs.gutter,
      logTaskGutter: logs.taskGutter,
      ready,
      setProfile: setAwsProfile,
      setRegion: setAwsRegion,
      setConnectionId: setS3ConnectionId,
      setRefreshSeconds,
      setLogTimestamps: (next) => updateSettings({ logs: { timestamps: next } }),
      // Clamped here as well as in the schema: the drag handle reports
      // fractional pixels, and a value the schema would reject would come back
      // as the default instead of the narrowest allowed width.
      setLogGutter: (next) => updateSettings({ logs: { gutter: clampGutter(next) } }),
      setLogTaskGutter: (next) => updateSettings({ logs: { taskGutter: clampGutter(next) } }),
    }),
    [profile, region, connectionId, refreshSeconds, logs, ready],
  );
}

// ---------------------------------------------------------------------------
// Refresh

/** How often live lists poll, in seconds; -1 never. */
export function useRefreshSeconds(): number {
  return useSettings((state) => state.settings.refresh.seconds);
}

export function setRefreshSeconds(seconds: number): void {
  updateSettings({ refresh: { seconds } });
}

function clampGutter(value: number): number {
  return Math.max(MIN_LOG_GUTTER, Math.round(value));
}
