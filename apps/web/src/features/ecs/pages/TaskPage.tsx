import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Box, Terminal } from "lucide-react";
import * as React from "react";

import { KeyValue, KeyValueGrid } from "~/components/kv";
import { LogsPane } from "~/features/ecs/components/LogsPane";
import { useSessions } from "~/stores/sessions";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyIcon } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { StatusDot } from "~/components/ui/status-dot";
import { useAwsScope } from "~/contexts/ScopeContext";
import { cpuLabel, fullTimestamp, imageLabel, memoryLabel } from "~/lib/format";
import { taskTone } from "~/lib/status";
import { trpc } from "~/lib/trpc";

/** Bottom of the drill-down: one task and each of its containers. */
export function TaskPage({ cluster, taskId }: { cluster: string; taskId: string }) {
  const scope = useAwsScope();
  const openSession = useSessions((state) => state.open);
  const task = useQuery(trpc.ecs.task.queryOptions({ ...scope, cluster, taskId }));

  if (task.isPending)
    return (
      <Panel className="flex-1">
        <LoadingRows rows={8} />
      </Panel>
    );
  if (task.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={task.error} onRetry={() => void task.refetch()} />
      </Panel>
    );
  }
  if (!task.data) {
    return (
      <Panel className="flex-1">
        <EmptyState
          icon={Box}
          title="Task not found"
          hint="Stopped tasks age out of the ECS API after an hour."
        />
      </Panel>
    );
  }

  const data = task.data;
  const tone = taskTone(data);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <Panel className="shrink-0">
        <PanelHeader>
          <StatusDot tone={tone.tone} pulse={tone.pulse} />
          <PanelTitle className="font-mono text-[12px] tracking-normal text-foreground normal-case">
            {data.id}
          </PanelTitle>
          <CopyIcon value={data.arn} label="task ARN" />
          <Badge tone={data.lastStatus === "RUNNING" ? "success" : "neutral"}>
            {data.lastStatus}
          </Badge>
          {data.serviceName ? (
            <Link
              to="/ecs/clusters/$cluster/services/$service"
              params={{ cluster, service: data.serviceName }}
              className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {data.serviceName}
            </Link>
          ) : null}
        </PanelHeader>
        <KeyValueGrid className="px-3.5 py-2.5">
          <KeyValue label="Task definition">{data.taskDefinition}</KeyValue>
          <KeyValue label="Desired status">{data.desiredStatus}</KeyValue>
          <KeyValue label="Health">{data.health}</KeyValue>
          <KeyValue label="Launch type">{data.launchType ?? data.capacityProvider ?? "-"}</KeyValue>
          <KeyValue label="CPU">{cpuLabel(data.cpu)}</KeyValue>
          <KeyValue label="Memory">{memoryLabel(data.memory)}</KeyValue>
          <KeyValue label="Private IP">{data.privateIp ?? "-"}</KeyValue>
          <KeyValue label="Availability zone">{data.availabilityZone ?? "-"}</KeyValue>
          <KeyValue label="Started">{relativeTime(data.startedAt)}</KeyValue>
          {data.stoppedAt ? (
            <KeyValue label="Stopped">{relativeTime(data.stoppedAt)}</KeyValue>
          ) : null}
        </KeyValueGrid>
        {data.stoppedReason ? (
          <p className="mx-3.5 mb-3 rounded-md border border-danger/30 bg-danger/8 px-3 py-2 font-mono text-[11.5px] text-danger">
            {data.stoppedReason}
          </p>
        ) : null}
      </Panel>

      <Panel className="shrink-0">
        <PanelHeader>
          <PanelTitle>Containers</PanelTitle>
          <span className="font-mono text-[11px] text-muted-foreground tabular">
            {data.containers.length}
          </span>
        </PanelHeader>
        <div className="flex flex-col divide-y divide-border">
          {data.containers.map((container) => (
            <div key={container.name} className="px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <StatusDot
                  tone={
                    container.lastStatus === "RUNNING"
                      ? container.health === "UNHEALTHY"
                        ? "danger"
                        : "success"
                      : "warning"
                  }
                />
                <span className="text-[13px] font-medium">{container.name}</span>
                <Badge tone={container.lastStatus === "RUNNING" ? "success" : "neutral"}>
                  {container.lastStatus}
                </Badge>
                {container.exitCode !== null ? (
                  <Badge tone={container.exitCode === 0 ? "neutral" : "danger"}>
                    exit {container.exitCode}
                  </Badge>
                ) : null}
                <Button
                  className="ml-auto"
                  disabled={!data.enableExecuteCommand || container.lastStatus !== "RUNNING"}
                  title={
                    data.enableExecuteCommand
                      ? "Open a shell in this container"
                      : "ECS Exec is not enabled on this task"
                  }
                  onClick={() =>
                    openSession({
                      kind: "ecs",
                      profile: scope.profile,
                      region: scope.region,
                      cluster,
                      taskId,
                      containerName: container.name,
                    })
                  }
                >
                  <Terminal className="size-3" /> Shell
                </Button>
              </div>
              <KeyValueGrid className="mt-1">
                <KeyValue label="Image">{imageLabel(container.image)}</KeyValue>
                <KeyValue label="Health">{container.health}</KeyValue>
                <KeyValue label="CPU">{cpuLabel(container.cpu)}</KeyValue>
                <KeyValue label="Memory">{memoryLabel(container.memory)}</KeyValue>
                <KeyValue label="Runtime id">{container.runtimeId ?? "-"}</KeyValue>
                {container.reason ? <KeyValue label="Reason">{container.reason}</KeyValue> : null}
              </KeyValueGrid>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="min-h-[22rem] shrink-0">
        <PanelHeader>
          <PanelTitle>Logs</PanelTitle>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            this task only · pick a container below
          </span>
        </PanelHeader>
        <LogsPane taskDefinition={data.taskDefinition} taskId={data.id} scopeLabel={data.id} />
      </Panel>

      <p className="px-1 pb-1 font-mono text-[10px] text-muted-foreground/70">
        task started {fullTimestamp(data.startedAt)}
      </p>
    </div>
  );
}
