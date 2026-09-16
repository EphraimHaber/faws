import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, FileJson, Layers, Rocket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * The front door of the ECS section: one card per thing ECS can show, each
 * carrying the count that says whether it is worth opening.
 *
 * `/ecs` used to *be* the cluster list, which left the section with no place
 * to add a second view. The list now lives at `/ecs/clusters` and this page
 * names the choice instead of guessing it.
 */
export function EcsIndexPage() {
  const scope = useAwsScope();
  const { region } = useScope();

  const clusters = useQuery(trpc.ecs.clusters.queryOptions(scope));
  const clusterList = React.useMemo(() => clusters.data ?? [], [clusters.data]);

  // Deployment counts need the services behind every cluster; the queries are
  // the same ones the pages below use, so opening a card is already warm.
  const serviceQueries = useQueries({
    queries: clusterList.map((cluster) =>
      trpc.ecs.services.queryOptions({ ...scope, cluster: cluster.name }),
    ),
  });

  const loadingServices = serviceQueries.some((query) => query.isPending);
  const services = React.useMemo(
    () => serviceQueries.flatMap((query) => query.data ?? []),
    [serviceQueries],
  );

  const deployed = services.filter((service) => service.lastDeploymentAt).length;
  const families = new Set(services.map((service) => service.taskDefinitionFamily)).size;

  if (clusters.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={clusters.error} onRetry={() => void clusters.refetch()} />
      </Panel>
    );
  }

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>ECS</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">{region}</span>
      </PanelHeader>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <SectionCard
          to="/ecs/clusters"
          icon={Layers}
          label="Clusters"
          description="Every cluster in the region, with the task counts that decide where to go next."
          metric={clusters.isPending ? "…" : String(clusterList.length)}
          metricLabel={clusterList.length === 1 ? "cluster" : "clusters"}
        />
        <SectionCard
          to="/ecs/deployments"
          icon={Rocket}
          label="Recently deployed"
          description="Every service that has rolled out, newest first, with rollout state and failures."
          metric={loadingServices ? "…" : String(deployed)}
          metricLabel={deployed === 1 ? "service" : "services"}
        />
        <SectionCard
          to="/ecs/task-definitions"
          icon={FileJson}
          label="Task definitions"
          description="The registry behind the services: families, revisions and what they run."
          metric={loadingServices ? "…" : String(families)}
          metricLabel={families === 1 ? "family in use" : "families in use"}
        />
      </div>
    </Panel>
  );
}

function SectionCard({
  to,
  icon: Icon,
  label,
  description,
  metric,
  metricLabel,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  description: string;
  metric: string;
  metricLabel: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-3 rounded-md border border-border p-3.5 transition-colors hover:border-primary/45 hover:bg-accent/50"
    >
      <span className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.7} />
        <span className="text-[13px]">{label}</span>
        <ArrowRight
          aria-hidden
          className="ml-auto size-3.5 text-muted-foreground/40 transition-colors group-hover:text-foreground"
          strokeWidth={1.8}
        />
      </span>

      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-[22px] leading-none tabular">{metric}</span>
        <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          {metricLabel}
        </span>
      </span>

      <span className="text-[11.5px] leading-snug text-muted-foreground">{description}</span>
    </Link>
  );
}
