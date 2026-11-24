import type { ConnectionRef, StorageFeatures } from "@faws/kit";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "~/lib/trpc";

/** Until the provider answers, nothing beyond the object API is offered. */
const UNTIL_KNOWN: StorageFeatures = {
  bucketRegions: false,
  storageMetrics: false,
  presign: false,
};

/**
 * What the panes may offer for a connection.
 *
 * A pane only some providers can fill is better absent than present and
 * permanently failing, so this decides what is shown rather than what is
 * retried.
 */
export function useStorageFeatures(connection: ConnectionRef): StorageFeatures {
  const features = useQuery({
    ...trpc.storage.features.queryOptions({ ref: connection }),
    staleTime: 60_000,
  });
  return features.data ?? UNTIL_KNOWN;
}
