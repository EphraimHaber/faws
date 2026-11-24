/**
 * The list reads, made in process with `@kubernetes/client-node` instead of
 * by spawning `kubectl`, for contexts whose credentials faws can present
 * itself: a bearer token or a client certificate. A context that runs an exec
 * plugin or an auth provider, or that skips TLS verification, gets null here
 * and is read through the CLI, which supports exactly what the person's
 * cluster expects.
 *
 * Every call carries a deadline, since a cluster behind a VPN that is down
 * does not refuse, it hangs.
 */
import * as fs from "node:fs";

import type { KubeContextInfo } from "@faws/contracts";
import { EndpointTrustError } from "@faws/contracts";
import { ExecSessionError } from "@faws/kit/server";
import { trustReason } from "@faws/shared";
import {
  ApiException,
  ApisApi,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  type ConfigurationOptions,
  type ObservableMiddleware,
  setHeaderMiddleware,
} from "@kubernetes/client-node";

import { KubeUnauthorizedError } from "./errors.ts";
import { existingKubeconfigPaths } from "./kubeconfig.ts";

const TIMEOUT_MS = 10_000;

/** Raw JSON lists, the same shape `kubectl get -o json` prints. */
export interface NativeReader {
  list(path: NativeList, signal?: AbortSignal): Promise<{ items?: unknown[] }>;
  apiGroups(signal?: AbortSignal): Promise<string[]>;
}

export type NativeList =
  | { kind: "namespaces" }
  | { kind: "pods"; namespace: string }
  | { kind: "custom"; group: string; version: string; plural: string; namespace: string };

let loaded: { key: string; config: KubeConfig } | null = null;

/** The merged kubeconfig, parsed again only when one of its files has changed. */
function kubeConfig(): KubeConfig {
  const files = existingKubeconfigPaths();
  const key = files
    .map((file) => {
      try {
        return `${file}@${fs.statSync(file).mtimeMs}`;
      } catch {
        return file;
      }
    })
    .join("|");
  if (loaded?.key === key) return loaded.config;
  const config = new KubeConfig();
  config.loadFromDefault({ onInvalidEntry: "filter" });
  loaded = { key, config };
  return config;
}

/** A reader for `context`, or null when its auth or TLS settings are for the CLI to handle. */
export function nativeReaderFor(context: KubeContextInfo): NativeReader | null {
  if (context.auth !== "token" && context.auth !== "certificate") return null;
  if (process.env["FAWS_KUBE_READS"] === "cli") return null;

  const base = kubeConfig();
  const entry = base.getContextObject(context.name);
  const cluster = entry ? base.getCluster(entry.cluster) : null;
  const user = entry ? base.getUser(entry.user) : null;
  // client-node will not speak plain http to an API server, and a skipped check is the CLI's to make.
  if (!entry || !cluster || !user || cluster.skipTLSVerify) return null;
  if (!cluster.server.startsWith("https://")) return null;
  if (!user.token && !user.certData && !user.certFile) return null;

  // A copy pinned to this context, so concurrent reads of different contexts never share state.
  const config = new KubeConfig();
  config.loadFromOptions({
    clusters: [cluster],
    users: [user],
    contexts: [entry],
    currentContext: entry.name,
  });
  const core = config.makeApiClient(CoreV1Api);
  const custom = config.makeApiClient(CustomObjectsApi);
  const apis = config.makeApiClient(ApisApi);

  return {
    async list(path, signal) {
      const options = withDeadline(signal);
      const result = await call(context, cluster.server, () => {
        switch (path.kind) {
          case "namespaces":
            return core.listNamespace({}, options);
          case "pods":
            return core.listNamespacedPod({ namespace: path.namespace }, options);
          case "custom":
            return custom.listNamespacedCustomObject(
              {
                group: path.group,
                version: path.version,
                namespace: path.namespace,
                plural: path.plural,
              },
              options,
            ) as Promise<unknown>;
        }
      });
      // Models carry Dates where the wire has strings; one round trip gives back the wire shape.
      return JSON.parse(JSON.stringify(result)) as { items?: unknown[] };
    },
    async apiGroups(signal) {
      const groups = await call(context, cluster.server, () =>
        apis.getAPIVersions({}, withDeadline(signal)),
      );
      return groups.groups.map((group) => group.name);
    },
  };
}

function withDeadline(signal: AbortSignal | undefined): ConfigurationOptions<ObservableMiddleware> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  // The generated clients take observable middleware; this one borrows its plumbing and adds the signal.
  const base = setHeaderMiddleware("Accept", "application/json");
  return {
    middleware: [
      {
        pre: (request) => {
          request.setSignal(combined);
          return base.pre(request);
        },
        post: (response) => base.post(response),
      },
    ],
    middlewareMergeStrategy: "append",
  };
}

/** The same failures the CLI path reports, so a page cannot tell which path read it. */
async function call<T>(context: KubeContextInfo, server: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiException) {
      const status = (err as ApiException<unknown>).code;
      const said = messageOf((err as ApiException<unknown>).body) ?? err.message;
      if (status === 401) {
        throw new KubeUnauthorizedError({
          context: context.name,
          server: context.server,
          user: context.userName,
        });
      }
      if (status === 403) throw new ExecSessionError("KubeForbidden", said);
      if (status === 404) throw new ExecSessionError("KubeVirtUnavailable", said);
      throw new ExecSessionError("Internal", said);
    }
    const trust = trustReason(err);
    if (trust) throw new EndpointTrustError(server, trust);
    throw new ExecSessionError(
      "KubeApiUnreachable",
      `${server} could not be reached: ${err instanceof Error ? err.message : String(err)}. Check you are on the network or VPN it sits behind.`,
    );
  }
}

function messageOf(body: unknown): string | null {
  if (typeof body === "string") {
    try {
      return messageOf(JSON.parse(body));
    } catch {
      return body || null;
    }
  }
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : null;
}
