import type { ResourceRef } from "@faws/contracts";
import { normalizePrefix } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as React from "react";

import { PinButton } from "~/components/PinButton";
import { Segmented } from "~/components/segmented";
import { AnalyticsPane } from "~/features/s3/components/AnalyticsPane";
import { BucketProperties } from "~/features/s3/components/BucketProperties";
import { ObjectBrowser } from "~/features/s3/components/ObjectBrowser";
import { ObjectViewer } from "~/features/s3/components/ObjectViewer";
import { VersionsPane } from "~/features/s3/components/VersionsPane";
import { Badge } from "~/components/ui/badge";
import { ErrorState } from "~/components/ui/error-state";
import { Panel } from "~/components/ui/panel";
import { useS3Scope, useScope } from "~/contexts/ScopeContext";
import { ConnectionPicker } from "~/features/s3/components/ConnectionPicker";
import { useS3Capabilities } from "~/features/s3/useS3Capabilities";
import { useTabSearch } from "~/hooks/useTabSearch";
import { trpc } from "~/lib/trpc";
import { useRecordVisit } from "~/stores/recents";

/** The tabs, in the order they are shown; the first is the default. */
export const BUCKET_TABS = ["objects", "properties", "versions", "analytics"] as const;

type Tab = (typeof BUCKET_TABS)[number];

/**
 * One bucket, opened at a prefix.
 *
 * The region is resolved here because this is the first point at which it is
 * needed: every call against the objects inside is addressed to the bucket's
 * own region, which is not always the one the rest of the app is scoped to.
 */
export function BucketPage({ bucket }: { bucket: string }) {
  const scope = useS3Scope();
  const { region: scopeRegion } = useScope();
  const capabilities = useS3Capabilities();
  const navigate = useNavigate();
  const { prefix = "", object } = useSearch({ from: "/s3/buckets/$bucket" });
  const [tab, setTab] = useTabSearch(BUCKET_TABS, "objects");

  const region = useQuery({
    ...trpc.s3.bucketRegion.queryOptions({ ...scope, bucket }),
    // An endpoint outside AWS has one region for every bucket it serves, so
    // there is nothing to resolve and nothing to report as unexpected.
    enabled: capabilities.bucketRegions,
    staleTime: Infinity,
  });

  // Whether a delete here can be undone is part of what a confirmation has to
  // say, so it is read alongside the bucket rather than guessed at the dialog.
  const versioning = useQuery({
    ...trpc.s3.versioning.queryOptions({ ...scope, bucket }),
    staleTime: 5 * 60_000,
  });

  // The bucket root and a prefix inside it are two different destinations, so
  // they are two different kinds and two different keys - coming back to
  // `logs/2026/` is the useful thing to remember, not that the bucket exists.
  // The dwell in `useRecordVisit` is what keeps a walk down the tree from
  // leaving a row for every folder passed through on the way.
  const target = React.useMemo<ResourceRef>(
    () => ({
      kind: prefix ? "s3-prefix" : "s3-bucket",
      id: prefix ? `${bucket}/${prefix}` : bucket,
      label: prefix
        ? normalizePrefix(prefix).replace(/\/$/, "").split("/").pop() || bucket
        : bucket,
      detail: prefix ? `${bucket}/${prefix}` : "bucket",
      scope: {
        profile: scope.profile,
        region: scopeRegion,
        connectionId: scope.connectionId ?? "",
      },
      to: prefix
        ? `/s3/buckets/${encodeURIComponent(bucket)}?prefix=${encodeURIComponent(prefix)}`
        : `/s3/buckets/${encodeURIComponent(bucket)}`,
    }),
    [bucket, prefix, scope.profile, scope.connectionId, scopeRegion],
  );
  useRecordVisit(target);

  const goTo = (next: { prefix?: string; object?: string }) =>
    void navigate({
      to: "/s3/buckets/$bucket",
      params: { bucket },
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        ...(next.prefix === undefined
          ? {}
          : { prefix: next.prefix.length > 0 ? next.prefix : undefined }),
        ...(next.object === undefined ? {} : { object: next.object || undefined }),
      })) as never,
      replace: true,
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
          onChange={(next: Tab) => setTab(next)}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <PinButton target={target} />
          <ConnectionPicker />
        </div>
        {region.data && region.data !== scopeRegion ? (
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
              onNavigate={(next) => goTo({ prefix: normalizePrefix(next), object: "" })}
              onOpenObject={(key) => goTo({ object: key })}
            />
          </div>

          {object ? (
            <div className="flex min-h-0 flex-1 flex-col lg:w-[46%] lg:min-w-[22rem] lg:flex-none">
              <ObjectViewer
                bucket={bucket}
                objectKey={object}
                onClose={() => goTo({ object: "" })}
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
          <VersionsPane
            bucket={bucket}
            prefix={prefix}
            onOpenVersion={(key) => {
              // Opening a version means leaving for the pane that can show it.
              setTab("objects");
              goTo({ object: key });
            }}
          />
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
