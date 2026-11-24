/**
 * Kubernetes on the server: its tRPC router, the shell it can open into a
 * pod, and the lookups the host uses to tell whether this machine has a
 * kubeconfig and a kubectl at all.
 */
import type { ExecHandshakeAuth } from "@faws/contracts";
import type { TerminalContribution } from "@faws/kit/server";

import { kubeDriverFactory } from "./exec/kube.driver.ts";

export { kubeRouter } from "./kube.router.ts";
export { resolveKubeBinary } from "./binaries.ts";
export { existingKubeconfigPaths } from "./kubeconfig.ts";

export const kubernetesTerminals: ReadonlyArray<TerminalContribution<"kube", ExecHandshakeAuth>> = [
  { kind: "kube", factory: kubeDriverFactory },
];
