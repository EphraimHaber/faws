import { useQuery } from "@tanstack/react-query";
import { Database, Plug } from "lucide-react";

import { SectionCard } from "~/components/section-card";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useS3Scope } from "~/contexts/ScopeContext";
import { useS3Connections } from "~/features/s3/useS3Connections";
import { trpc } from "~/lib/trpc";

/**
 * The front door of the S3 section: one card per thing S3 can show, each
 * carrying the count that says whether it is worth opening.
 */
export function S3IndexPage() {
  const scope = useS3Scope();
  const buckets = useQuery(trpc.s3.buckets.queryOptions(scope));
  const count = buckets.data?.length ?? 0;
  const endpoints = useS3Connections();

  if (buckets.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={buckets.error} onRetry={() => void buckets.refetch()} />
      </Panel>
    );
  }

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>S3</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {/* Buckets are an account wide list, so naming a region here would
              claim a scope the numbers below do not have. */}
          all regions
        </span>
      </PanelHeader>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <SectionCard
          to="/s3/buckets"
          icon={Database}
          label="Buckets"
          description="Every bucket the account can see, and the region each one answers in."
          metric={buckets.isPending ? "…" : String(count)}
          metricLabel={count === 1 ? "bucket" : "buckets"}
        />
        <SectionCard
          to="/s3/connections"
          icon={Plug}
          label="Endpoints"
          description="S3 compatible servers on your own network, and the keys each one is reached with."
          metric={String(endpoints.length)}
          metricLabel={endpoints.length === 1 ? "endpoint" : "endpoints"}
        />
      </div>
    </Panel>
  );
}
