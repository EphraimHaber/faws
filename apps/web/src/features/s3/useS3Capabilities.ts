import { s3CapabilitiesFor, type S3Capabilities } from "@faws/contracts";
import * as React from "react";

import { useScope } from "~/contexts/ScopeContext";
import { useS3Connections } from "~/features/s3/useS3Connections";

/**
 * What the panes may offer for the endpoint in scope.
 *
 * An S3 compatible server implements the object API and little around it, so
 * the answer decides what is shown rather than what is retried: a pane only
 * AWS can fill is better absent than present and permanently failing.
 *
 * Decided here from the record the settings snapshot already carries, with the
 * same function the server would use, so there is no round trip to be stale or
 * in flight and no second opinion to disagree.
 */
export function useS3Capabilities(): S3Capabilities {
  const { connectionId } = useScope();
  const connections = useS3Connections();

  return React.useMemo(
    () => s3CapabilitiesFor(connections.find((entry) => entry.id === connectionId) ?? null),
    [connections, connectionId],
  );
}
