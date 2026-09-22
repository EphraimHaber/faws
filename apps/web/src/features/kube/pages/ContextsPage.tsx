import type { KubeContextInfo } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Ship } from "lucide-react";
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
import { hasNoCli, NoKubectl } from "~/features/kube/components/NoKubectl";
import { useKubeDiagnostics } from "~/features/kube/useKubeDiagnostics";
import { useFilterSearch } from "~/hooks/useSearchState";
import { trpc } from "~/lib/trpc";

/**
 * The contexts in your kubeconfig, and what each one would do.
 *
 * The auth column is the reason this page is worth having rather than being a
 * dropdown. `sshConfig.ts` states the principle it follows: a config file is
 * not somewhere this app should take instructions to execute, and it refuses
 * `ProxyCommand` by name rather than ignoring it. A kubeconfig `exec`
 * credential plugin is the same class of thing. The defensible difference is
 * that the plugin runs inside the user's own `kubectl` rather than being
 * invoked by us - but "defensible" is not "invisible", so the command is named
 * here instead of being left implicit.
 */
export function ContextsPage() {
  const { context: active, setContext } = useKubeScope();
  const [filter, setFilter] = useFilterSearch();
  const diagnostics = useKubeDiagnostics();
  const contexts = useQuery({ ...trpc.kube.contexts.queryOptions(), retry: false });
  const rows = contexts.data ?? [];

  const columns = React.useMemo<Column<KubeContextInfo>[]>(
    () => [
      {
        id: "name",
        header: "Context",
        value: (row) => row.name,
        cell: (row) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-[12.5px]">{row.name}</span>
            {row.current ? <Badge tone="info">kubeconfig default</Badge> : null}
          </span>
        ),
      },
      {
        id: "server",
        header: "Server",
        width: "18rem",
        value: (row) => row.server ?? row.clusterName,
        mono: true,
      },
      {
        id: "namespace",
        header: "Namespace",
        width: "10rem",
        value: (row) => row.namespace ?? "-",
      },
      {
        id: "auth",
        header: "Authenticates by",
        width: "16rem",
        // Filterable, so `auth:plugin` lists every context that runs something
        // to get a token - which is the question this column exists to answer.
        value: (row) => (row.execPlugin ? `plugin ${row.execPlugin}` : row.userName),
        cell: (row) =>
          row.execPlugin ? (
            <span
              className="flex min-w-0 items-center gap-1.5"
              title={`Running \`${row.execPlugin}\` gets this context's credentials. It runs inside your own kubectl, not from faws.`}
            >
              <Badge tone="warning">exec plugin</Badge>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {row.execPlugin}
              </span>
            </span>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">
              {row.userName || "-"}
            </span>
          ),
      },
      {
        id: "use",
        header: "",
        width: "6rem",
        align: "right",
        value: (row) => (row.name === active ? "current" : ""),
        cell: (row) =>
          row.name === active ? (
            <span className="font-mono text-[10.5px] text-muted-foreground/70">in view</span>
          ) : (
            <Button onClick={() => setContext(row.name)} title="Point these pages at this context">
              Use
            </Button>
          ),
      },
    ],
    [active, setContext],
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
        <PanelTitle>Contexts</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">{rows.length}</span>
        <div className="ml-auto">
          <FilterInput
            value={filter}
            onChange={setFilter}
            total={rows.length}
            placeholder="Filter… (try auth:plugin)"
          />
        </div>
      </PanelHeader>

      {contexts.isPending ? (
        <LoadingRows rows={6} />
      ) : contexts.isError ? (
        <ErrorState error={contexts.error} onRetry={() => void contexts.refetch()} />
      ) : (
        <DataTable
          tableId="kube-contexts"
          rows={rows}
          columns={columns}
          rowKey={(row) => row.name}
          filter={filter}
          onClearFilter={() => setFilter("")}
          emptyState={
            <EmptyState
              icon={Ship}
              title="No contexts"
              // Where we looked, not just that we failed: a KUBECONFIG naming
              // a file that is not there looks identical to having none until
              // the paths are on screen.
              hint={
                diagnostics.data
                  ? `Looked at ${diagnostics.data.kubeconfigPaths.join(", ")}. Set KUBECONFIG, or create a kubeconfig, then refresh.`
                  : "No kubeconfig was found."
              }
            />
          }
        />
      )}
    </Panel>
  );
}
