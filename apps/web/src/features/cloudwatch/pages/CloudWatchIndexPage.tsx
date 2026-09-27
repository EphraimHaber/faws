import { useQuery } from "@tanstack/react-query";
import { Gauge, ScrollText } from "lucide-react";

import { SectionCard } from "~/components/section-card";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * The front door of the CloudWatch section.
 *
 * Only log groups are counted here. Counting metrics means listing every one
 * of them, which on a busy account is ten calls for a number nobody decides
 * anything by, so the metrics card waits to be opened.
 */
export function CloudWatchIndexPage() {
  const scope = useAwsScope();
  const { region } = useScope();
  const groups = useQuery(trpc.cloudwatch.logGroups.queryOptions(scope));
  const count = groups.data?.groups.length ?? 0;

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>CloudWatch</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">{region}</span>
      </PanelHeader>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <SectionCard
          to="/cloudwatch/log-groups"
          icon={ScrollText}
          label="Log groups"
          description="Every log group in this region, its streams, and a tail of what it holds."
          metric={
            groups.isPending
              ? "…"
              : groups.isError
                ? "-"
                : `${count}${groups.data.truncated ? "+" : ""}`
          }
          metricLabel={count === 1 ? "group" : "groups"}
        />
        <SectionCard
          to="/cloudwatch/metrics"
          icon={Gauge}
          label="Metrics"
          description="Any metric reported in the last two weeks, by namespace, charted on request."
          metric="-"
          metricLabel="browse"
        />
      </div>
    </Panel>
  );
}
