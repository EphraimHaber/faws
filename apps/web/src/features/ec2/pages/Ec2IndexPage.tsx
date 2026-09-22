import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";

import { SectionCard } from "~/components/section-card";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * The front door of the EC2 section.
 *
 * The service registry has always named `/ec2` as EC2's root, and the sidebar
 * and the breadcrumb have always linked to it, but no route answered - so the
 * one row in the sidebar that says "EC2" led to Not Found. This is that route.
 *
 * The count is instances the account can see in the scoped region, which is
 * also the number that decides whether opening the list is worth it.
 */
export function Ec2IndexPage() {
  const scope = useAwsScope();
  const { region } = useScope();
  const targets = useQuery(trpc.exec.targets.queryOptions(scope));
  const count = targets.data?.length ?? 0;

  if (targets.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />
      </Panel>
    );
  }

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>EC2</PanelTitle>
        {/* Instances are regional, so naming the region here is a claim the
            number below actually has - unlike S3, whose buckets are account
            wide. */}
        <span className="font-mono text-[11px] text-muted-foreground tabular">{region}</span>
      </PanelHeader>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <SectionCard
          to="/ec2/instances"
          icon={Server}
          label="Instances"
          description="Every instance in this region, and what each one can be reached by."
          metric={targets.isPending ? "…" : String(count)}
          metricLabel={count === 1 ? "instance" : "instances"}
        />
      </div>
    </Panel>
  );
}
