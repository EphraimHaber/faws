import type { ResourceRef } from "@faws/contracts";
import { normalizePrefix } from "@faws/shared";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as React from "react";

import { BUCKET_TABS, BucketBrowser } from "~/capabilities/object-storage/BucketBrowser";
import { StorageConnectionProvider } from "~/capabilities/object-storage/connection";
import { PinButton } from "~/components/PinButton";
import { ConnectionPicker } from "~/features/s3/components/ConnectionPicker";
import { useS3Connection } from "~/features/s3/useS3Connection";
import { useTabSearch } from "~/hooks/useTabSearch";
import { useAwsScope } from "~/stores/scope";
import { useRecordVisit } from "~/stores/recents";

export { BUCKET_TABS };

/** One bucket on AWS or on a saved endpoint, opened at a prefix. */
export function BucketPage({ bucket }: { bucket: string }) {
  const { connection, endpointId } = useS3Connection();
  const { profile, region } = useAwsScope();
  const navigate = useNavigate();
  const { prefix = "", object } = useSearch({ from: "/s3/buckets/$bucket" });
  const [tab, setTab] = useTabSearch(BUCKET_TABS, "objects");

  // The bucket root and a prefix inside it are two different destinations, so
  // they are two different kinds and two different keys - coming back to
  // `logs/2026/` is the useful thing to remember, not that the bucket exists.
  // The dwell in `useRecordVisit` is what keeps a walk down the tree from
  // leaving a row for every folder passed through on the way.
  //
  // A bucket on a saved endpoint is not reached through the AWS profile, so it
  // is recorded without one and stays listed whatever the title bar says.
  const target = React.useMemo<ResourceRef>(() => {
    const search = new URLSearchParams();
    if (endpointId) search.set("connection", endpointId);
    if (prefix) search.set("prefix", prefix);
    const query = search.toString();
    return {
      kind: prefix ? "s3-prefix" : "s3-bucket",
      id: prefix ? `${bucket}/${prefix}` : bucket,
      label: prefix
        ? normalizePrefix(prefix).replace(/\/$/, "").split("/").pop() || bucket
        : bucket,
      detail: prefix ? `${bucket}/${prefix}` : "bucket",
      scope: endpointId
        ? { profile: "", region: "", connectionId: endpointId }
        : { profile, region, connectionId: "" },
      to: `/s3/buckets/${encodeURIComponent(bucket)}${query ? `?${query}` : ""}`,
    };
  }, [bucket, prefix, endpointId, profile, region]);
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

  return (
    <StorageConnectionProvider connection={connection}>
      <BucketBrowser
        bucket={bucket}
        prefix={prefix}
        object={object}
        tab={tab}
        onTab={setTab}
        onNavigate={goTo}
        onOpenObject={(key) => {
          // Opening a version means leaving for the pane that can show it.
          setTab("objects");
          goTo({ object: key });
        }}
        homeRegion={endpointId ? undefined : region}
        toolbar={
          <>
            <PinButton target={target} />
            <ConnectionPicker />
          </>
        }
      />
    </StorageConnectionProvider>
  );
}
