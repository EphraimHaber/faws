import type { KubeVirtualMachineInfo } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Monitor, TerminalSquare } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { DisabledHint } from "~/components/WriteGuard";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { useKubeScope } from "~/contexts/ScopeContext";
import { KubeScopePicker } from "~/features/kube/components/KubeScopePicker";
import { hasNoCli, NoKubectl } from "~/features/kube/components/NoKubectl";
import { useKubeDiagnostics } from "~/features/kube/useKubeDiagnostics";
import { useFilterSearch } from "~/hooks/useSearchState";
import type { ExecTarget } from "~/lib/terminal/handshake";
import { trpc } from "~/lib/trpc";
import { useSessions } from "~/stores/sessions";

/** The guest login `virtctl ssh` uses when nobody has said otherwise. */
const DEFAULT_GUEST_USER = "cloud-user";

/**
 * KubeVirt machines, and the two ways onto one.
 *
 * The page redirects rather than rendering when the cluster has no KubeVirt.
 * The sidebar already hides the section there, so the only way to arrive is an
 * old link or a hand-typed URL, and the honest answer to both is the section
 * that does exist - not an empty table implying the machines were deleted.
 *
 * With KubeVirt but no `virtctl`, the list renders and the controls are
 * disabled with the reason on them. That is the distinction the whole feature
 * degrades on: absent when the thing does not exist, stated when it exists and
 * something on this machine is missing.
 */
export function VirtualMachinesPage() {
  const navigate = useNavigate();
  const { context, namespace, ready } = useKubeScope();
  const open = useSessions((state) => state.open);
  const [filter, setFilter] = useFilterSearch();
  const diagnostics = useKubeDiagnostics();

  const kubeVirt = diagnostics.data?.kubeVirt ?? false;
  const noVirtctl = diagnostics.data !== undefined && !diagnostics.data.virtctl.found;

  React.useEffect(() => {
    if (diagnostics.data && !diagnostics.data.kubeVirt) {
      void navigate({ to: "/kubernetes", replace: true });
    }
  }, [diagnostics.data, navigate]);

  const machines = useQuery({
    ...trpc.kube.virtualMachines.queryOptions({ context, namespace }),
    enabled: ready && kubeVirt,
    retry: false,
  });
  const rows = machines.data ?? [];

  const columns = React.useMemo<Column<KubeVirtualMachineInfo>[]>(
    () => [
      { id: "name", header: "Machine", value: (row) => row.name },
      {
        id: "status",
        header: "Status",
        width: "9rem",
        value: (row) => row.status,
        cell: (row) => (
          <Badge tone={row.status === "Running" ? "success" : "neutral"}>{row.status}</Badge>
        ),
      },
      {
        id: "agent",
        header: "Agent",
        width: "8rem",
        // Running is not the same as reachable: `virtctl ssh` lands through the
        // guest agent, so a machine that is up without one takes a console and
        // nothing else.
        value: (row) => (row.ready ? "ready" : row.running ? "starting" : ""),
        cell: (row) =>
          row.ready ? (
            <Badge tone="info">ready</Badge>
          ) : (
            <span className="font-mono text-[10.5px] text-muted-foreground/60">-</span>
          ),
      },
      {
        id: "node",
        header: "Node",
        width: "14rem",
        value: (row) => row.nodeName ?? "-",
        mono: true,
      },
      {
        id: "connect",
        header: "Connect",
        width: "14rem",
        align: "right",
        value: (row) => (row.running ? "console" : "stopped"),
        cell: (row) => (
          <Connect
            row={row}
            context={context}
            namespace={namespace}
            noVirtctl={noVirtctl}
            onOpen={open}
          />
        ),
      },
    ],
    [context, namespace, noVirtctl, open],
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
        <PanelTitle>Virtual machines</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">{rows.length}</span>
        {noVirtctl ? (
          <span
            className="font-mono text-[10.5px] text-warning"
            title={diagnostics.data?.virtctl.problem ?? "virtctl was not found."}
          >
            no virtctl
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <KubeScopePicker />
          <FilterInput
            value={filter}
            onChange={setFilter}
            total={rows.length}
            placeholder="Filter… (try status:Running)"
          />
        </div>
      </PanelHeader>

      {machines.isPending && ready && kubeVirt ? (
        <LoadingRows rows={8} />
      ) : machines.isError ? (
        <ErrorState error={machines.error} onRetry={() => void machines.refetch()} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.name}
          filter={filter}
          emptyState={
            <EmptyState
              icon={Monitor}
              title="No virtual machines"
              hint={`Nothing in ${context} / ${namespace}`}
            />
          }
        />
      )}
    </Panel>
  );
}

function Connect({
  row,
  context,
  namespace,
  noVirtctl,
  onOpen,
}: {
  row: KubeVirtualMachineInfo;
  context: string;
  namespace: string;
  noVirtctl: boolean;
  onOpen: (target: ExecTarget) => string;
}) {
  if (!row.running) {
    return (
      <span className="font-mono text-[10.5px] text-muted-foreground/70" title={row.status}>
        stopped
      </span>
    );
  }

  const consoleReason = noVirtctl ? "virtctl is not installed on this machine" : null;
  const sshReason =
    consoleReason ??
    (row.ready ? null : "The guest agent is not reporting, so ssh has nothing to land on");
  const target = (mode: "ssh" | "console"): ExecTarget => ({
    kind: "kube",
    context,
    namespace,
    target:
      mode === "ssh"
        ? { tool: "virtctl", mode: "ssh", vm: row.name, user: DEFAULT_GUEST_USER }
        : { tool: "virtctl", mode: "console", vm: row.name },
  });

  return (
    <span className="flex items-center justify-end gap-1.5">
      <DisabledHint reason={sshReason}>
        <Button
          variant="default"
          disabled={sshReason !== null}
          title={`virtctl ssh ${DEFAULT_GUEST_USER}@${row.name}`}
          onClick={() => onOpen(target("ssh"))}
        >
          <TerminalSquare className="size-3" />
          SSH
        </Button>
      </DisabledHint>
      <DisabledHint reason={consoleReason}>
        <Button
          disabled={consoleReason !== null}
          title="Attach to the serial console"
          onClick={() => onOpen(target("console"))}
        >
          Console
        </Button>
      </DisabledHint>
    </span>
  );
}
