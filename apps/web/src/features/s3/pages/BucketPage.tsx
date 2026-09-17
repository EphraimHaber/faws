import { useQuery } from "@tanstack/react-query";

import { KeyValue, KeyValueGrid } from "~/components/kv";
import { CopyButton } from "~/components/ui/copy-button";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { Spinner } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * One bucket.
 *
 * The region is resolved here rather than in the bucket list because this is
 * the first point at which it is needed: every call against the objects inside
 * is addressed to the bucket's own region, which is not always the one the
 * rest of the app is scoped to.
 */
export function BucketPage({ bucket }: { bucket: string }) {
  const scope = useAwsScope();
  const region = useQuery({
    ...trpc.s3.bucketRegion.queryOptions({ ...scope, bucket }),
    staleTime: Infinity,
  });

  if (region.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={region.error} onRetry={() => void region.refetch()} />
      </Panel>
    );
  }

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>Bucket</PanelTitle>
        <span className="truncate font-mono text-[12px]">{bucket}</span>
        <CopyButton size="icon" variant="ghost" value={bucket} label="Copy bucket name" />
      </PanelHeader>

      <div className="p-3.5">
        <KeyValueGrid>
          <KeyValue label="Name">{bucket}</KeyValue>
          <KeyValue label="Region">
            {region.isPending ? <Spinner /> : (region.data ?? "-")}
          </KeyValue>
          <KeyValue label="Scope region" className="text-muted-foreground">
            {scope.region}
          </KeyValue>
        </KeyValueGrid>
      </div>
    </Panel>
  );
}
