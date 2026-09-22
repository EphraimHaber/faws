import type { ExecKind } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { Link } from "@tanstack/react-router";

import { EntityRow } from "~/components/entity-row";
import { PinButton } from "~/components/PinButton";
import { FilterInput } from "~/components/toolbar";
import { Button } from "~/components/ui/button";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { SectionHeader } from "~/components/ui/section-header";
import { textActionClass } from "~/components/ui/text-action";
import { useAwsScope, useKubeScope } from "~/contexts/ScopeContext";
import { hasNoCli } from "~/features/kube/components/NoKubectl";
import { useKubeDiagnostics } from "~/features/kube/useKubeDiagnostics";
import { useFilterSearch } from "~/hooks/useSearchState";
import {
  type Connectable,
  type ConnectMemory,
  instanceConnectable,
  podConnectable,
  searchConnectables,
  sshHostConnectable,
} from "~/lib/terminal/connectable";
import { trpc } from "~/lib/trpc";
import { recentActions } from "~/stores/recents";
import { useSessions } from "~/stores/sessions";
import { useSettings } from "~/stores/settings";

/**
 * Everything a session can be opened to from here, in one searchable list.
 *
 * Each source is the one its own page already uses - the instances in the AWS
 * scope in view, the Host aliases in `~/.ssh/config`, the pods in the kube
 * scope in view - so nothing here is a second opinion about what exists. A
 * source that cannot answer says why in its own group rather than leaving a
 * gap, and ECS points at the clusters instead of listing tasks, because a
 * task list for every cluster is one AWS call per cluster to draw a page.
 *
 * Opening something records it, and pinned and recently opened rows sort to
 * the top of their group while the filter is empty.
 */
export function ConnectPanel() {
  const open = useSessions((state) => state.open);
  const visited = useSettings((state) => state.settings.recents.visited);
  const pinned = useSettings((state) => state.settings.recents.pinned);
  const memory = React.useMemo<ConnectMemory>(
    () => ({
      pinned: new Set(Object.keys(pinned)),
      visited: new Map(Object.entries(visited).map(([key, entry]) => [key, entry.at])),
    }),
    [visited, pinned],
  );
  const [filter, setFilter] = useFilterSearch();
  const aws = useAwsScope();
  const kube = useKubeScope();
  const diagnostics = useKubeDiagnostics();
  const noKubeCli = diagnostics.data ? hasNoCli(diagnostics.data) : false;

  const instances = useQuery(trpc.exec.targets.queryOptions(aws));
  const hosts = useQuery(trpc.exec.sshHosts.queryOptions());
  const pods = useQuery({
    ...trpc.kube.pods.queryOptions({ context: kube.context, namespace: kube.namespace }),
    enabled: kube.ready && !noKubeCli,
    retry: false,
  });

  const openShift = diagnostics.data?.openShift ?? false;
  const rows: Connectable[] = [
    ...(instances.data ?? []).map((row) => instanceConnectable(row, aws)),
    ...(hosts.data ?? []).map(sshHostConnectable),
    ...(pods.data ?? []).map((row) => podConnectable(row, kube.context, kube.namespace, openShift)),
  ];
  const groups = searchConnectables(rows, filter, memory);
  const shown = groups.reduce((sum, group) => sum + group.rows.length, 0);

  // Why a source has nothing to list, when it has nothing to list.
  const notes: Record<ExecKind, string | undefined> = {
    ecs: undefined,
    ssm: instances.isPending
      ? "Looking for instances..."
      : instances.isError
        ? `Could not list instances: ${instances.error.message}`
        : undefined,
    ssh: hosts.data?.length === 0 ? "No Host entries with a HostName in ~/.ssh/config." : undefined,
    kube: noKubeCli
      ? "kubectl is not installed on this machine."
      : !kube.ready
        ? "No kubeconfig context to list pods from."
        : pods.isPending
          ? "Looking for pods..."
          : pods.isError
            ? `Could not list pods: ${pods.error.message}`
            : undefined,
  };

  const labels: Record<ExecKind, string> = {
    ecs: "ECS tasks",
    ssm: `EC2 instances in ${aws.profile} / ${aws.region}`,
    ssh: "SSH hosts",
    kube: kube.ready ? `Pods in ${kube.context} / ${kube.namespace}` : "Pods",
  };

  const kinds: ExecKind[] = ["ssm", "ssh", "kube"];

  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader>
        <PanelTitle>Connect</PanelTitle>
        <div className="ml-auto">
          <FilterInput
            value={filter}
            onChange={setFilter}
            count={shown}
            total={rows.length}
            placeholder="Find an instance, host or pod…"
          />
        </div>
      </PanelHeader>

      <div className="flex min-h-0 flex-col overflow-auto pb-2">
        {kinds.map((kind) => {
          const group = groups.find((entry) => entry.kind === kind);
          const note = notes[kind];
          if (!group && !note && filter) return null;
          return (
            <section key={kind}>
              <SectionHeader
                title={labels[kind]}
                count={group?.rows.length ?? 0}
                className="mx-3.5 mt-2 mb-1"
              />
              {note ? (
                <p className="px-3.5 py-1.5 text-[12px] text-muted-foreground">{note}</p>
              ) : null}
              <ul>
                {group?.rows.map((row) => (
                  <li key={row.key}>
                    <EntityRow
                      label={row.label}
                      detail={row.detail}
                      actions={
                        <>
                          {row.unavailable ? (
                            <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70">
                              {row.unavailable}
                            </span>
                          ) : (
                            row.actions.map((action, index) => (
                              <Button
                                key={action.label}
                                size="xs"
                                variant={index === 0 ? "outline" : "ghost"}
                                title={action.title}
                                onClick={() => {
                                  open(action.target);
                                  recentActions.record(row.ref);
                                }}
                              >
                                {action.label}
                              </Button>
                            ))
                          )}
                          {row.pinnable ? <PinButton target={row.ref} /> : null}
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section>
          <SectionHeader title={labels.ecs} className="mx-3.5 mt-2 mb-1" />
          <p className="px-3.5 py-1.5 text-[12px] text-muted-foreground">
            ECS exec opens from a running task.{" "}
            <Link to="/ecs/clusters" className={textActionClass}>
              pick a cluster
            </Link>
          </p>
        </section>
      </div>
    </Panel>
  );
}
