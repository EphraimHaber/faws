import type { S3Capabilities } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";

import { useS3Scope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * What the panes may offer for the endpoint in scope.
 *
 * An S3 compatible server implements the object API and little around it, so
 * the answer decides what is shown rather than what is retried: a pane that
 * only AWS can fill is better absent than present and permanently failing.
 *
 * The fallback while this is in flight assumes an endpoint can do less, not
 * more, so nothing flashes on screen only to disappear.
 */
export function useS3Capabilities(): S3Capabilities {
  const scope = useS3Scope();
  const query = useQuery({
    ...trpc.s3Connections.capabilities.queryOptions(scope),
    staleTime: Infinity,
  });

  const onAws = !scope.connectionId;
  return query.data ?? { bucketRegions: onAws, storageMetrics: onAws, presign: onAws };
}
