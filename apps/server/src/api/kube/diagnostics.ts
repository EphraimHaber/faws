/**
 * What this machine has for talking to a cluster, gathered for one page.
 *
 * Its own module because it is the one place that asks every other part of
 * `api/kube` a question - the binaries, the kubeconfig, the cluster itself -
 * and nothing asks it anything back. Kept beside the binary lookup, it made
 * that lookup import the modules that import it.
 */
import type { KubeBinaryInfo, KubeContextInfo, KubeDiagnostics } from "@faws/contracts";

import { type KubeToolName, resolveKubeBinary } from "./binaries.ts";
import { runKubeText } from "./cli.ts";
import { existingKubeconfigPaths, kubeconfigPaths, listKubeContexts } from "./kubeconfig.ts";
import { probeCapabilities } from "./resources.ts";

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
