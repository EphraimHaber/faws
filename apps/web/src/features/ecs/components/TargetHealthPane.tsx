import type { TargetGroupHealth, TargetHealth } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import * as React from "react";

import { Badge } from "~/components/ui/badge";
import { CopyIcon } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { LoadingRows } from "~/components/ui/spinner";
import { StatusDot, type StatusTone } from "~/components/ui/status-dot";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

/**
 * Load balancer target health.
 *
 * "ECS started the task" and "traffic reaches the task" are different claims,
 * and a rollout that looks healthy in ECS while every target sits in `initial`
 * or `unhealthy` is the single most common way a deploy silently fails. The
 * health check settings are shown alongside because they are what determines
 * how long `initial` is allowed to last.
 */
export function TargetHealthPane({ cluster, service }: { cluster: string; service: string }) {
  const scope = useAwsScope();
  const { refreshSeconds } = useScope();

  const health = useQuery({
    ...trpc.ecs.targetHealth.queryOptions({ ...scope, cluster, service }),
    ...(refreshSeconds > 0 ? { refetchInterval: refreshSeconds * 1000 } : {}),
  });

  if (health.isPending) return <LoadingRows rows={5} />;
  if (health.isError) {
    return <ErrorState error={health.error} onRetry={() => void health.refetch()} />;
  }

  const groups = health.data ?? [];
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="This service isn't behind a load balancer"
        hint="Nothing registers targets, so ECS treats a task as available as soon as it is RUNNING."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {groups.map((group) => (
        <TargetGroupCard key={group.targetGroupArn} group={group} />
      ))}
    </div>
  );
}

function TargetGroupCard({ group }: { group: TargetGroupHealth }) {
  const counts = React.useMemo(() => tally(group.targets), [group.targets]);

  return (
    <section className="border-b border-border last:border-b-0">
      <header className="flex flex-wrap items-center gap-2.5 px-3.5 py-2">
        <StatusDot
          tone={counts.unhealthy > 0 ? "danger" : counts.initial > 0 ? "warning" : "success"}
          pulse={counts.initial > 0}
        />
        <span className="font-mono text-[12px]">{group.targetGroupName}</span>
        <CopyIcon value={group.targetGroupArn} label="target group ARN" />

        {group.containerName ? (
          <Badge>
            {group.containerName}
            {group.containerPort ? `:${group.containerPort}` : ""}
          </Badge>
        ) : null}

        <span className="flex items-center gap-1.5">
          {counts.healthy > 0 ? <Badge tone="success">{counts.healthy} healthy</Badge> : null}
          {counts.initial > 0 ? <Badge tone="warning">{counts.initial} initial</Badge> : null}
          {counts.unhealthy > 0 ? <Badge tone="danger">{counts.unhealthy} unhealthy</Badge> : null}
          {counts.draining > 0 ? <Badge tone="info">{counts.draining} draining</Badge> : null}
        </span>

        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
          {group.protocol ?? "-"} {group.healthCheckPath ?? ""}
          {group.healthCheckIntervalSeconds ? ` · every ${group.healthCheckIntervalSeconds}s` : ""}
          {group.healthyThresholdCount
            ? ` · ${group.healthyThresholdCount} to pass / ${group.unhealthyThresholdCount ?? "?"} to fail`
            : ""}
        </span>
      </header>

      {group.targets.length === 0 ? (
        <p className="px-3.5 pb-3 text-[12px] text-muted-foreground">
          No targets registered yet — ECS registers a task once it reaches RUNNING.
        </p>
      ) : (
        <ul className="px-3.5 pb-2.5">
          {group.targets.map((target) => (
            <li
              key={`${target.targetId}:${target.port ?? ""}`}
              className="flex items-baseline gap-2.5 py-1"
            >
              <StatusDot
                tone={stateTone(target.state)}
                pulse={target.state === "initial"}
                className="translate-y-[3px]"
              />
              <span
                className="w-44 shrink-0 truncate font-mono text-[11.5px]"
                title={target.targetId}
              >
                {target.targetId}
                {target.port ? `:${target.port}` : ""}
              </span>
              <span
                className={cn(
                  "w-20 shrink-0 font-mono text-[10.5px] uppercase",
                  stateClass(target.state),
                )}
              >
                {target.state}
              </span>
              <span className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
                {target.description ?? target.reason ?? ""}
              </span>
              {target.availabilityZone ? (
                <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70">
                  {target.availabilityZone}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function tally(targets: ReadonlyArray<TargetHealth>) {
  return {
    healthy: targets.filter((t) => t.state === "healthy").length,
    initial: targets.filter((t) => t.state === "initial").length,
    unhealthy: targets.filter((t) => t.state === "unhealthy").length,
    draining: targets.filter((t) => t.state === "draining").length,
  };
}

function stateTone(state: string): StatusTone {
  if (state === "healthy") return "success";
  if (state === "unhealthy") return "danger";
  if (state === "initial") return "warning";
  if (state === "draining") return "info";
  return "neutral";
}

function stateClass(state: string): string {
  if (state === "healthy") return "text-success";
  if (state === "unhealthy") return "text-danger";
  if (state === "initial") return "text-warning";
  if (state === "draining") return "text-info";
  return "text-muted-foreground";
}
