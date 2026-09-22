/**
 * The three binaries this app spawns to talk to a cluster.
 *
 * Nothing here reimplements Kubernetes: real kubeconfigs authenticate through
 * exec credential plugins (`aws eks get-token`, `oc`, `gke-gcloud-auth-plugin`),
 * client certificates and proxies, and `kubectl` is the reference
 * implementation of all of it. A library with a different support list would
 * list pods the shell then cannot reach, which is the worst failure this
 * feature can have. It is the same position this repo already takes on
 * `~/.ssh/config` and `session-manager-plugin`: read it, spawn it, do not
 * rewrite it.
 *
 * The search itself is `shared/binaries.ts`, which is where the reason a
 * Homebrew binary is invisible to a GUI-launched app is written down.
 */
import type { KubeBinaryInfo, KubeContextInfo, KubeDiagnostics } from "@faws/contracts";

import { forgetBinary, resolveBinary, type BinaryResolution } from "../../shared/binaries.ts";
import { runKubeText } from "./cli.ts";
import { existingKubeconfigPaths, kubeconfigPaths, listKubeContexts } from "./kubeconfig.ts";
import { probeCapabilities } from "./resources.ts";

export type KubeToolName = "kubectl" | "oc" | "virtctl";

const ENV_VARS: Record<KubeToolName, string> = {
  kubectl: "FAWS_KUBECTL",
  oc: "FAWS_OC",
  virtctl: "FAWS_VIRTCTL",
};

/** Where the usual installers land, for the launchd-PATH case. */
const EXTRA_PATHS: Record<KubeToolName, readonly string[]> = {
  kubectl: ["/opt/homebrew/bin/kubectl", "/usr/local/bin/kubectl", "/usr/bin/kubectl"],
  oc: ["/opt/homebrew/bin/oc", "/usr/local/bin/oc", "/usr/bin/oc"],
  virtctl: ["/opt/homebrew/bin/virtctl", "/usr/local/bin/virtctl", "/usr/bin/virtctl"],
};

const INSTALL_HINTS: Record<KubeToolName, string> = {
  kubectl:
    "kubectl was not found. Install it (`brew install kubectl`, or your distribution's package), or point FAWS_KUBECTL at it, then reopen this panel.",
  oc: "The OpenShift CLI was not found. Install `oc` from your cluster's downloads page, or point FAWS_OC at it, then reopen this panel.",
  virtctl:
    "virtctl was not found, so KubeVirt consoles and SSH are unavailable. Install it from the KubeVirt release matching your cluster, or point FAWS_VIRTCTL at it.",
};

export function resolveKubeBinary(tool: KubeToolName): BinaryResolution {
  return resolveBinary(tool, {
    envVar: ENV_VARS[tool],
    extraPaths: EXTRA_PATHS[tool],
    installHint: INSTALL_HINTS[tool],
  });
}

/** For a settings screen that re-checks after an install. */
export function forgetKubeBinaries(): void {
  for (const tool of Object.keys(ENV_VARS) as KubeToolName[]) forgetBinary(tool);
}

/**
 * Why a Kubernetes page is empty.
 *
 * Everything here is a state a perfectly healthy machine can be in: plenty of
 * people have no `kubectl`, no kubeconfig, or a cluster that is neither
 * OpenShift nor running KubeVirt. So this answers with facts rather than
 * throwing, and the pages degrade to a sentence saying what is missing and
 * where we looked. The one thing it must not do is fail, because a diagnostics
 * call that errors leaves the page with nothing to explain itself with.
 *
 * `--client` on the version call is what keeps it from contacting a cluster:
 * this question is about the machine, and a context pointing at a VPN that is
 * down would otherwise make it hang.
 */
export async function kubeDiagnostics(
  options: { context?: string; signal?: AbortSignal } = {},
): Promise<KubeDiagnostics> {
  const [kubectl, oc, virtctl] = await Promise.all([
    describeBinary("kubectl", options.signal),
    describeBinary("oc", options.signal),
    describeBinary("virtctl", options.signal),
  ]);

  let contexts: readonly KubeContextInfo[] = [];
  let kubeconfigFound = existingKubeconfigPaths().length > 0;
  try {
    contexts = await listKubeContexts(options.signal ? { signal: options.signal } : {});
  } catch {
    // A kubeconfig that cannot be read is indistinguishable, from here, from
    // one that is not there - and has the same page and the same next step.
    kubeconfigFound = false;
  }

  const current = contexts.find((context) => context.current)?.name ?? null;
  const probed = options.context ?? current;
  const capabilities = probed
    ? await probeCapabilities(probed, options.signal ? { signal: options.signal } : {})
    : { openShift: false, kubeVirt: false };

  return {
    kubectl,
    oc,
    virtctl,
    kubeconfigPaths: kubeconfigPaths(),
    kubeconfigFound,
    currentContext: current,
    contextNames: contexts.map((context) => context.name),
    openShift: capabilities.openShift,
    kubeVirt: capabilities.kubeVirt,
  };
}

async function describeBinary(
  tool: KubeToolName,
  signal: AbortSignal | undefined,
): Promise<KubeBinaryInfo> {
  const found = resolveKubeBinary(tool);
  if (!found.path) {
    return { name: tool, found: false, path: null, version: null, problem: found.problem };
  }
  return {
    name: tool,
    found: true,
    path: found.path,
    version: await readVersion(tool, found.path, signal),
    problem: null,
  };
}

/** Reported so "which kubectl is this" is answerable from the screen. */
async function readVersion(
  tool: KubeToolName,
  file: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const argv = tool === "virtctl" ? ["version", "--client"] : ["version", "--client=true"];
  try {
    const text = await runKubeText(file, argv, signal ? { signal } : {});
    const match = /v\d+\.\d+\.\d+\S*/.exec(text);
    return match?.[0] ?? text.trim().split("\n")[0] ?? null;
  } catch {
    return null;
  }
}
