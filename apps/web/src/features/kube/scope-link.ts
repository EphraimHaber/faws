import type { ResourceRef } from "@faws/contracts";
import { defaultStringifySearch } from "@tanstack/react-router";
import { z } from "zod";

const WORKLOADS = "/kubernetes/workloads";

/**
 * A kube scope carried in a URL, for a link that has to open a particular
 * cluster rather than whichever one is selected.
 *
 * Only a request: the page moves the stored scope to it and drops it from the
 * URL, so the setting stays the one place the scope lives. The server checks
 * the name again before anything reaches `kubectl`, which is why this only
 * bounds the length.
 */
export const kubeScopeSearch = z.object({
  context: z.string().min(1).max(253).optional().catch(undefined),
  namespace: z.string().min(1).max(63).optional().catch(undefined),
});

/**
 * The context, pointed at the list it was used from.
 *
 * A pod is not the thing to remember: its name carries a replica-set hash and
 * changes on every rollout, so a stored one navigates to something that no
 * longer exists within the day. The context and namespace are what somebody
 * comes back to, so both go in the link; without them the row would open
 * whatever cluster happened to be selected.
 */
export function kubeContextRef(context: string, namespace: string): ResourceRef {
  return {
    kind: "kube-context",
    id: `${context}/${namespace}`,
    label: context,
    detail: namespace,
    // Unscoped: a cluster is reached from this machine rather than through an
    // AWS account, so it stays listed whichever profile is in view.
    scope: { profile: "", region: "", connectionId: "" },
    // The router's own encoder, so a name like `123` comes back as a string.
    to: `${WORKLOADS}${defaultStringifySearch({ context, namespace })}`,
  };
}
