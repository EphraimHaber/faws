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
import { forgetBinary, resolveBinary, type BinaryResolution } from "../../shared/binaries.ts";

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
