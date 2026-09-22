import type { KubePodInfo } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Boxes, TerminalSquare } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { useKubeScope } from "~/contexts/ScopeContext";
import { KubeScopePicker } from "~/features/kube/components/KubeScopePicker";
import { hasNoCli, NoKubectl } from "~/features/kube/components/NoKubectl";
import { kubeContextRef } from "~/features/kube/scope-link";
import { useKubeDiagnostics } from "~/features/kube/useKubeDiagnostics";
import { useFilterSearch } from "~/hooks/useSearchState";
import type { ExecTarget } from "~/lib/terminal/handshake";
import { trpc } from "~/lib/trpc";
import { recentActions } from "~/stores/recents";
import { useSessions } from "~/stores/sessions";
import { updateSettings, useSettings } from "~/stores/settings";

/**
 * Pods in the scoped namespace, listed for one reason: getting a shell in one.
 *
 * So the columns are the ones that decide whether that will work - the phase,
 * how many containers are ready out of how many there are, how often they have
 * restarted, which node it landed on - rather than a general inventory. It is a
 * `DataTable` like every list in this app, which is what gives it headers,
 * aligned columns, sorting and `column:value` filtering for free.
 *
 * The Shell button stays on a pod this context may not be allowed to exec
 * into, deliberately. `pods/exec` is a separate permission from listing pods,
 * and nothing short of a SelfSubjectAccessReview can answer it in advance - so
 * the session reports `KubeForbidden` with its remediation rather than the
 * button quietly deciding on the cluster's behalf.
 */
export function WorkloadsPage() {
  useAdoptLinkedScope();
  const { context, namespace, ready } = useKubeScope();
  const open = useSessions((state) => state.open);
  const [filter, setFilter] = useFilterSearch();
  const diagnostics = useKubeDiagnostics();
  const pods = useQuery({
    ...trpc.kube.pods.queryOptions({ context, namespace }),
    enabled: ready,
    retry: false,
  });
  const rows = pods.data ?? [];
  const openShift = diagnostics.data?.openShift ?? false;

  const columns = React.useMemo<Column<KubePodInfo>[]>(
    () => [
      {
        id: "pod",
        header: "Pod",
        value: (row) => row.name,
        cell: (row) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px]">{row.name}</span>
            <span className="truncate font-mono text-[10.5px] text-muted-foreground">
              {row.containers
                .filter((container) => !container.init)
                .map((container) => container.name)
                .join(", ") || "-"}
            </span>
          </span>
        ),
      },
      {
        id: "phase",
        header: "Phase",
        width: "8rem",
        value: (row) => row.phase,
        cell: (row) => (
          <Badge
            tone={
              row.phase === "Running" ? "success" : row.phase === "Failed" ? "danger" : "warning"
            }
          >
            {row.phase}
          </Badge>
        ),
      },
      {
        id: "ready",
        header: "Ready",
        width: "6rem",
        value: (row) => `${row.readyContainers}/${row.totalContainers}`,
        cell: (row) => (
          <span className="font-mono text-[11px] tabular">
            {row.readyContainers}/{row.totalContainers}
          </span>
        ),
      },
      {
        id: "restarts",
        header: "Restarts",
        width: "7rem",
        align: "right",
        value: (row) => row.restarts,
        cell: (row) => {
          // The reason is what turns a restart count into something actionable:
          // a pod at 47 restarts with `CrashLoopBackOff` will not hold a shell
          // long enough to read anything, and this is where that is visible.
          const reason = row.containers.find((container) => container.reason)?.reason ?? null;
          return (
            <span className="flex items-center justify-end gap-1.5">
              {reason ? <Badge tone="danger">{reason}</Badge> : null}
              <span className="font-mono text-[11px] tabular">{row.restarts}</span>
            </span>
          );
        },
      },
      {
        id: "node",
        header: "Node",
        width: "14rem",
        value: (row) => row.nodeName ?? "-",
        mono: true,
      },
      {
        id: "shell",
        header: "Shell",
        width: "13rem",
        align: "right",
        // Sortable and filterable by whether a shell can land, which is the one
        // question this page exists to answer: `shell:no shell` lists the pods
        // that are up in name only.
        value: (row) => (row.execReady ? "shell" : "no shell"),
        cell: (row) => (
          <Connect
            row={row}
            context={context}
            namespace={namespace}
            openShift={openShift}
            onOpen={open}
          />
        ),
      },
    ],
    [context, namespace, openShift, open],
  );

  if (diagnostics.data && hasNoCli(diagnostics.data)) {
    return (
      <Panel className="flex-1">
        <NoKubectl diagnostics={diagnostics.data} />
      </Panel>
    );
  }

  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader>
        <PanelTitle>Workloads</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">{rows.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <KubeScopePicker />
          <FilterInput
            value={filter}
            onChange={setFilter}
            total={rows.length}
            placeholder="Filter… (try phase:Running)"
          />
        </div>
      </PanelHeader>

      {pods.isPending && ready ? (
        <LoadingRows rows={10} />
      ) : pods.isError ? (
        <ErrorState error={pods.error} onRetry={() => void pods.refetch()} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.name}
          filter={filter}
          emptyState={
            <EmptyState
              icon={Boxes}
              title="No pods"
              hint={ready ? `Nothing in ${context} / ${namespace}` : "Pick a context to look in."}
            />
          }
        />
      )}
    </Panel>
  );
}

/**
 * The way into a pod, or a plain statement that there is not one.
 *
 * A pod with no ready container says so as text rather than offering a disabled
 * button, the same distinction the EC2 list draws with `unreachable`: the point
 * of it is that there is nothing to press.
 */
function Connect({
  row,
  context,
  namespace,
  openShift,
  onOpen,
}: {
  row: KubePodInfo;
  context: string;
  namespace: string;
  openShift: boolean;
  onOpen: (target: ExecTarget) => string;
}) {
  if (!row.execReady) {
    return (
      <span
        className="font-mono text-[10.5px] text-muted-foreground/70"
        title={`${row.phase}, with ${row.readyContainers} of ${row.totalContainers} containers ready`}
      >
        no shell
      </span>
    );
  }

  const container = row.containers.find((entry) => !entry.init && entry.ready)?.name;
  const target = {
    pod: row.name,
    ...(container ? { container } : {}),
  };

  return (
    <span className="flex items-center justify-end gap-1.5">
      <Button
        variant="default"
        title={`kubectl exec into ${container ?? row.name}`}
        onClick={() => {
          // Recorded on the shell rather than on a dwell, because this list has
          // no per-pod page to sit on: what makes a pod worth remembering is
          // that you got into it. The ref points at the context, since a pod
          // name changes on every rollout and a link to a dead one is a link to
          // nothing.
          recentActions.record(kubeContextRef(context, namespace));
          onOpen({ kind: "kube", context, namespace, target: { tool: "kubectl", ...target } });
        }}
      >
        <TerminalSquare className="size-3" />
        Shell
      </Button>

      {/* Only where `oc` has something to talk to: `rsh` on a cluster that is
          not OpenShift is a command that will not run. */}
      {openShift ? (
        <Button
          title={`oc rsh into ${container ?? row.name}`}
          onClick={() => {
            recentActions.record(kubeContextRef(context, namespace));
            onOpen({ kind: "kube", context, namespace, target: { tool: "oc", ...target } });
          }}
        >
          rsh
        </Button>
      ) : null}
    </span>
  );
}

/**
 * Moves the stored kube scope to the one a link asked for, then takes it out
 * of the URL so a reload or a copied address does not keep forcing it back.
 *
 * Waits for the first settings load: a change written before it lands is
 * overwritten by it, which on a cold open would leave the old cluster selected.
 */
function useAdoptLinkedScope() {
  const search = useSearch({ from: "/kubernetes/workloads" });
  const navigate = useNavigate();
  const loaded = useSettings((state) => state.ready);
  const { context, namespace } = search;

  React.useLayoutEffect(() => {
    if (!loaded || context === undefined) return;
    updateSettings({ kube: { context, namespace: namespace ?? "" } });
    void navigate({
      to: ".",
      search: ({ context: _context, namespace: _namespace, ...rest }) => rest,
      replace: true,
    });
  }, [loaded, context, namespace, navigate]);
}
