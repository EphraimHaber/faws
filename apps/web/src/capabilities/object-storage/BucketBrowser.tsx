import { normalizePrefix } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";

import { AnalyticsPane } from "~/capabilities/object-storage/AnalyticsPane";
import { BucketProperties } from "~/capabilities/object-storage/BucketProperties";
import { useStorageConnection } from "~/capabilities/object-storage/connection";
import { ObjectBrowser } from "~/capabilities/object-storage/ObjectBrowser";
import { ObjectViewer } from "~/capabilities/object-storage/ObjectViewer";
import { useStorageFeatures } from "~/capabilities/object-storage/useStorageFeatures";
import { VersionsPane } from "~/capabilities/object-storage/VersionsPane";
import { Segmented } from "~/components/segmented";
import { Badge } from "~/components/ui/badge";
import { ErrorState } from "~/components/ui/error-state";
import { Panel } from "~/components/ui/panel";
import { trpc } from "~/lib/trpc";

/** The tabs, in the order they are shown; the first is the default. */
export const BUCKET_TABS = ["objects", "properties", "versions", "analytics"] as const;

export type BucketTab = (typeof BUCKET_TABS)[number];

/**
 * One bucket, opened at a prefix, for whichever connection is in context.
 *
 * Where the bucket is, which object is open and which tab is showing all
 * belong to the page, which keeps them in its URL; this draws them and reports
 * every move back.
 */
export function BucketBrowser({
  bucket,
  prefix,
  object,
  tab,
  onTab,
  onNavigate,
  onOpenObject,
  homeRegion,
  toolbar,
}: {
  bucket: string;
  prefix: string;
  object: string | undefined;
  tab: BucketTab;
  onTab: (next: BucketTab) => void;
  onNavigate: (next: { prefix?: string; object?: string }) => void;
  onOpenObject: (key: string) => void;
  /** The region the connection is scoped to, when it has one. */
  homeRegion?: string | undefined;
  toolbar?: React.ReactNode;
}) {
  const connection = useStorageConnection();
  const features = useStorageFeatures(connection);

  // Resolved here because this is the first point at which it is needed: a
  // provider that addresses buckets regionally reads each one in its own.
  const region = useQuery({
    ...trpc.storage.bucketRegion.queryOptions({ ref: connection, bucket }),
    enabled: features.bucketRegions,
    staleTime: Infinity,
  });

  // Whether a delete here can be undone is part of what a confirmation has to
  // say, so it is read alongside the bucket rather than guessed at the dialog.
  const versioning = useQuery({
    ...trpc.storage.versioning.queryOptions({ ref: connection, bucket }),
    staleTime: 5 * 60_000,
  });

  if (region.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={region.error} onRetry={() => void region.refetch()} />
      </Panel>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-0.5">
        <Segmented
          options={BUCKET_TABS.map((value) => ({ value, label: value }))}
          value={tab}
          onChange={(next: BucketTab) => onTab(next)}
        />
        <div className="ml-auto flex items-center gap-1.5">{toolbar}</div>
        {region.data && homeRegion && region.data !== homeRegion ? (
          <span className="flex items-center gap-2">
            <Badge tone="info">{region.data}</Badge>
            <span className="text-[11.5px] text-muted-foreground">
              This bucket lives outside the region in scope; it is read from there.
            </span>
          </span>
        ) : null}
      </div>

      {tab === "objects" ? (
        // Side by side where there is room, and stacked where there is not:
        // below about a thousand pixels two panes leave neither one wide
        // enough to read a key in.
        <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ObjectBrowser
              bucket={bucket}
              prefix={prefix}
              versioned={versioning.data ?? null}
              onNavigate={(next) => onNavigate({ prefix: normalizePrefix(next), object: "" })}
              onOpenObject={(key) => onNavigate({ object: key })}
            />
          </div>

          {object ? (
            <div className="flex min-h-0 flex-1 flex-col lg:w-[46%] lg:min-w-[22rem] lg:flex-none">
              <ObjectViewer
                bucket={bucket}
                objectKey={object}
                onClose={() => onNavigate({ object: "" })}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "properties" ? (
        <Panel className="min-h-0 flex-1">
          <BucketProperties bucket={bucket} />
        </Panel>
      ) : null}

      {tab === "versions" ? (
        <Panel className="min-h-0 flex-1">
          <VersionsPane bucket={bucket} prefix={prefix} onOpenVersion={onOpenObject} />
        </Panel>
      ) : null}

      {tab === "analytics" ? (
        <Panel className="min-h-0 flex-1">
          <AnalyticsPane bucket={bucket} prefix={prefix} />
        </Panel>
      ) : null}
    </div>
  );
}
