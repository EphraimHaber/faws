/**
 * Which contexts exist, and whether the one we were handed is one of them.
 *
 * Read through `kubectl config view -o json` rather than by parsing the file,
 * which is the reason this feature needs no YAML parser and no new dependency.
 * It is also the only reading that is correct: `KUBECONFIG` is a list, the
 * merge rules between its entries are `kubectl`'s own, and a second
 * implementation of them would eventually disagree with the tool that actually
 * runs the session.
 *
 * `assertKnownContext` is what lets a context name cross the wire at all. The
 * handshake's regex stops a value being read as a flag; this stops it naming a
 * cluster the person could not otherwise reach, and guarantees the string that
 * reaches the command line is one of ours rather than one of theirs.
 *
 * The answers are memoized for a few seconds, not for the life of the process:
 * a pre-flight check runs on every session start, and kubeconfigs do change
 * under a running app - `aws eks update-kubeconfig` is a thing people run in
 * the next window along.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { KubeContextInfo } from "@faws/contracts";

import { ExecSessionError } from "../exec/errors.ts";
import { resolveKubeBinary } from "./binaries.ts";
import { KubeCliError, runKubeJson } from "./cli.ts";

const MEMO_TTL_MS = 5_000;

/** Every file the search covers, in `kubectl`'s own precedence order. */
export function kubeconfigPaths(): readonly string[] {
  const configured = process.env["KUBECONFIG"]?.trim();
  if (configured) return configured.split(path.delimiter).filter(Boolean);
  return [path.join(os.homedir(), ".kube", "config")];
}

export function existingKubeconfigPaths(): readonly string[] {
  return kubeconfigPaths().filter((file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * The single file to pass as `--kubeconfig`, or null.
 *
 * Null when the set is a list, because `--kubeconfig` names one file and the
 * merged view of several is what the contexts were read from. In that case the
 * child inherits the same `KUBECONFIG` we read, which describes the same set.
 */
export function pinnedKubeconfig(): string | null {
  const existing = existingKubeconfigPaths();
  return existing.length === 1 ? (existing[0] ?? null) : null;
}

/** The shape `kubectl config view -o json` prints, as far as this reads it. */
interface RawConfig {
  readonly "current-context"?: string;
  readonly contexts?: ReadonlyArray<{
    readonly name?: string;
    readonly context?: {
      readonly cluster?: string;
      readonly user?: string;
      readonly namespace?: string;
    };
  }>;
  readonly clusters?: ReadonlyArray<{
    readonly name?: string;
    readonly cluster?: { readonly server?: string };
  }>;
  readonly users?: ReadonlyArray<{
    readonly name?: string;
    readonly user?: { readonly exec?: { readonly command?: string } };
  }>;
}

let memo: { at: number; contexts: readonly KubeContextInfo[] } | null = null;

export function forgetKubeContexts(): void {
  memo = null;
}

export async function listKubeContexts(
  options: { signal?: AbortSignal } = {},
): Promise<readonly KubeContextInfo[]> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.contexts;

  const kubectl = resolveKubeBinary("kubectl");
  if (!kubectl.path) {
    throw new ExecSessionError(
      "KubeBinaryMissing",
      kubectl.problem ?? "kubectl was not found on this machine.",
    );
  }

  const files = existingKubeconfigPaths();
  if (files.length === 0) {
    throw new ExecSessionError(
      "KubeconfigMissing",
      `No kubeconfig was found. Looked at ${kubeconfigPaths().join(", ")}. Set KUBECONFIG, or create one, then reopen this panel.`,
    );
  }

  const pinned = pinnedKubeconfig();
  const args = [...(pinned ? [`--kubeconfig=${pinned}`] : []), "config", "view", "-o", "json"];

  let raw: RawConfig;
  try {
    raw = await runKubeJson<RawConfig>(
      kubectl.path,
      args,
      options.signal ? { signal: options.signal } : {},
    );
  } catch (err) {
    throw new ExecSessionError(
      "KubeconfigMissing",
      err instanceof KubeCliError
        ? `Your kubeconfig could not be read: ${err.message}`
        : "Your kubeconfig could not be read.",
    );
  }

  const servers = new Map(
    (raw.clusters ?? []).map((entry) => [entry.name ?? "", entry.cluster?.server ?? null]),
  );
  const plugins = new Map(
    (raw.users ?? []).map((entry) => [entry.name ?? "", entry.user?.exec?.command ?? null]),
  );
  const current = raw["current-context"] ?? null;

  const contexts = (raw.contexts ?? [])
    .filter((entry) => typeof entry.name === "string" && entry.name.length > 0)
    .map<KubeContextInfo>((entry) => {
      const name = entry.name ?? "";
      const clusterName = entry.context?.cluster ?? "";
      const userName = entry.context?.user ?? "";
      return {
        name,
        clusterName,
        userName,
        namespace: entry.context?.namespace ?? null,
        server: servers.get(clusterName) ?? null,
        current: name === current,
        execPlugin: plugins.get(userName) ?? null,
      };
    });

  memo = { at: Date.now(), contexts };
  return contexts;
}

/** Returns the context, so the caller uses the value that was checked. */
export async function assertKnownContext(
  name: string,
  options: { signal?: AbortSignal } = {},
): Promise<KubeContextInfo> {
  const contexts = await listKubeContexts(options);
  const found = contexts.find((context) => context.name === name);
  if (found) return found;

  const known = contexts.map((context) => context.name);
  throw new ExecSessionError(
    "KubeContextUnknown",
    known.length === 0
      ? "Your kubeconfig defines no contexts, so there is nothing to connect to."
      : `There is no context named "${name}" in your kubeconfig. It has ${known.slice(0, 8).join(", ")}${known.length > 8 ? ", ..." : ""}.`,
  );
}
