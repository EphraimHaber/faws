import { useQuery } from "@tanstack/react-query";

import { useKubeScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * Why a Kubernetes page might be empty, asked once per context.
 *
 * Every page reads this before it reads anything else, because the states it
 * reports are ordinary states for a perfectly healthy machine: no `kubectl`, no
 * kubeconfig, a cluster that is not OpenShift, a cluster with no KubeVirt. The
 * procedure answers with facts rather than failing, so there is always
 * something to render a sentence from.
 *
 * Keyed by context, because `openShift` and `kubeVirt` are properties of the
 * cluster rather than of the machine, and a stale answer from the last context
 * would offer `oc rsh` against something that has never heard of it.
 */
export function useKubeDiagnostics() {
  const { context } = useKubeScope();
  return useQuery({
    ...trpc.kube.diagnostics.queryOptions(context ? { context } : {}),
    staleTime: 30_000,
    retry: false,
  });
}
