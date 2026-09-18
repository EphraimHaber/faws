import { normalizePrefix } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { Segmented } from "~/components/segmented";
import { AnalyticsPane } from "~/features/s3/components/AnalyticsPane";
import { BucketProperties } from "~/features/s3/components/BucketProperties";
import { ObjectBrowser } from "~/features/s3/components/ObjectBrowser";
import { ObjectViewer } from "~/features/s3/components/ObjectViewer";
import { VersionsPane } from "~/features/s3/components/VersionsPane";
import { Badge } from "~/components/ui/badge";
import { ErrorState } from "~/components/ui/error-state";
import { Panel } from "~/components/ui/panel";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { useTabSearch } from "~/hooks/useTabSearch";
import { trpc } from "~/lib/trpc";

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
  const scope = useAwsScope();
  const { region: scopeRegion } = useScope();
  const navigate = useNavigate();
  const { prefix = "", object } = useSearch({ from: "/s3/buckets/$bucket" });
  const [tab, setTab] = useTabSearch(BUCKET_TABS, "objects");

  const region = useQuery({
    ...trpc.s3.bucketRegion.queryOptions({ ...scope, bucket }),
    staleTime: Infinity,
  });

  // Whether a delete here can be undone is part of what a confirmation has to
  // say, so it is read alongside the bucket rather than guessed at the dialog.
  const versioning = useQuery({
    ...trpc.s3.versioning.queryOptions({ ...scope, bucket }),
    staleTime: 5 * 60_000,
  });

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
