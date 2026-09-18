import type { S3Connection } from "@faws/contracts";
import * as React from "react";

import { useSettings } from "~/stores/settings";

/**
 * Every S3 endpoint this machine knows about.
 *
 * They ride the settings snapshot, so one added in another window shows up
 * here without a refetch, and the first paint already has them.
 */
export function useS3Connections(): S3Connection[] {
  const connections = useSettings((state) => state.settings.s3.connections);
  return React.useMemo(
    () => [...connections].toSorted((a, b) => a.name.localeCompare(b.name)),
    [connections],
  );
}
