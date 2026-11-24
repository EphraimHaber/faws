/**
 * Kubernetes on the server: its tRPC router, the shell it can open into a
 * pod, and the lookups the host uses to tell whether this machine has a
 * kubeconfig and a kubectl at all.
 */
import type { ExecHandshakeAuth } from "@faws/contracts";
import { defineProviderServer, type TerminalContribution } from "@faws/kit/server";

import { kubernetesManifest } from "../manifest.ts";
import { kubeDriverFactory } from "./exec/kube.driver.ts";
import { kubeRouter } from "./kube.router.ts";

/** Mounted by the host under the manifest id, so the client path is `trpc.kubernetes`. */
export const kubernetesServer = defineProviderServer({
  id: kubernetesManifest.id,
  router: kubeRouter,
});
export { resolveKubeBinary } from "./binaries.ts";
export { existingKubeconfigPaths } from "./kubeconfig.ts";

export const kubernetesTerminals: ReadonlyArray<TerminalContribution<"kube", ExecHandshakeAuth>> = [
  { kind: "kube", factory: kubeDriverFactory },
];
