import { awsConnectionRef, s3EndpointRef } from "@faws/contracts";
import type { ConnectionRef } from "@faws/kit";
import { useSearch } from "@tanstack/react-router";
import * as React from "react";

import { useAwsScope } from "~/stores/scope";

export interface S3PageConnection {
  /** What every storage query on the page is keyed by. */
  readonly connection: ConnectionRef;
  /** The saved endpoint in view, or undefined while the page reads AWS. */
  readonly endpointId: string | undefined;
}

/**
 * The storage system an `/s3/...` page reads.
 *
 * A `connection` search param names a saved endpoint; without one the page
 * reads AWS through the profile and region in the title bar. Keeping it in the
 * URL is what lets a pinned bucket or a shared link come back to the same
 * endpoint it was recorded on.
 */
export function useS3Connection(): S3PageConnection {
  const { connection: endpointId } = useSearch({ strict: false }) as { connection?: string };
  const aws = useAwsScope();
  return React.useMemo(
    () => ({
      connection: endpointId ? s3EndpointRef(endpointId) : awsConnectionRef(aws),
      endpointId,
    }),
    [endpointId, aws],
  );
}
