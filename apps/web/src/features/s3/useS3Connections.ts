import type { S3Connection } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { trpc } from "~/lib/trpc";
import { useSettings } from "~/stores/settings";

/**
 * Every S3 endpoint this machine offers.
 *
 * The saved ones ride the settings snapshot, so adding one in a second window
 * shows up here without a refetch. The ones the environment describes are not
 * in that file and cannot change while the server runs, so they are asked for
 * once and merged in.
 */
export function useS3Connections(): S3Connection[] {
  const stored = useSettings((state) => state.settings.s3.connections);
  const fromEnv = useQuery({
    ...trpc.s3Connections.fromEnvironment.queryOptions(),
    staleTime: Infinity,
  });

  return React.useMemo(
    () => [...stored, ...(fromEnv.data ?? [])].toSorted((a, b) => a.name.localeCompare(b.name)),
    [stored, fromEnv.data],
  );
}
