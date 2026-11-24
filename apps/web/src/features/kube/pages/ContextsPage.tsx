import { type KubeContextInfo, type KubeLoginStatus, kubeUserLabel } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Server, Ship } from "lucide-react";
import * as React from "react";

import { EntityRow } from "~/components/entity-row";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { hasNoCli, NoKubectl } from "~/features/kube/components/NoKubectl";
import { openAddCluster, openKubeLogin } from "~/features/kube/loginDialogs";
import { useKubeDiagnostics } from "~/features/kube/useKubeDiagnostics";
import { useClock } from "~/hooks/useClock";
import { useFilterSearch } from "~/hooks/useSearchState";
import { trpc } from "~/lib/trpc";
import { useKubeScope } from "~/stores/scope";

/**
 * The contexts in your kubeconfig, grouped by the API server they reach, with
 * each one's login: who it is, whether the cluster still takes it and until
 * when, and the switch, log in again and log out actions.
 *
 * A context that authenticates through an exec plugin is named as such:
 * running it is something the person should know about, even though it runs
 * inside their own kubectl rather than from faws.
 */
export function ContextsPage() {
  const { context: active, setContext } = useKubeScope();
  const [filter, setFilter] = useFilterSearch();
  const diagnostics = useKubeDiagnostics();
  const contexts = useQuery({ ...trpc.kubernetes.contexts.queryOptions(), retry: false });
  const statuses = useQuery({
    ...trpc.kubernetes.loginStatuses.queryOptions(),
    retry: false,
    enabled: contexts.isSuccess,
  });
  const rows = contexts.data ?? [];

  const byContext = React.useMemo(
    () => new Map((statuses.data ?? []).map((status) => [status.context, status])),
    [statuses.data],
  );
  const groups = React.useMemo(
    () => groupByServer(contexts.data ?? [], filter),
    [contexts.data, filter],
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
      <PanelHeader refresh={[contexts, statuses]} refreshLabel="Refresh contexts and logins">
        <PanelTitle>Contexts</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">{rows.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <FilterInput
            value={filter}
            onChange={setFilter}
            total={rows.length}
            placeholder="Filter… (try plugin)"
          />
          <Button variant="default" onClick={openAddCluster}>
            <Plus className="size-3" /> Add cluster
          </Button>
        </div>
      </PanelHeader>

      {contexts.isPending ? (
        <LoadingRows rows={6} />
      ) : contexts.isError ? (
        <ErrorState error={contexts.error} onRetry={() => void contexts.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Ship}
          title={rows.length === 0 ? "No contexts" : "Nothing matches"}
          hint={
            rows.length === 0
              ? `Add a cluster, or look at ${diagnostics.data?.kubeconfigPaths.join(", ") ?? "your kubeconfig"}.`
              : "Clear the filter to see every context."
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {groups.map((group) => (
            <section key={group.server} aria-label={group.server}>
              <h3 className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                <Server className="size-3" strokeWidth={1.8} aria-hidden />
                <span className="min-w-0 truncate text-foreground">{group.server}</span>
                <span className="tabular">{group.contexts.length}</span>
              </h3>
              {group.contexts.map((row) => (
                <ContextRow
                  key={row.name}
                  row={row}
                  status={byContext.get(row.name) ?? null}
                  active={row.name === active}
                  onUse={() => setContext(row.name)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

interface ServerGroup {
  readonly server: string;
  readonly contexts: KubeContextInfo[];
}

function groupByServer(rows: readonly KubeContextInfo[], filter: string): ServerGroup[] {
  const needle = filter.trim().toLowerCase();
  const groups = new Map<string, KubeContextInfo[]>();
  for (const row of rows) {
    const haystack = [row.name, row.server, row.userName, row.namespace, row.execPlugin && "plugin"]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (needle && !haystack.includes(needle)) continue;
    const key = row.server ?? `(no server) ${row.clusterName}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([server, contexts]) => ({
      server,
      contexts: contexts.toSorted((a, b) => a.name.localeCompare(b.name)),
    }));
}

function ContextRow({
  row,
  status,
  active,
  onUse,
}: {
  row: KubeContextInfo;
  status: KubeLoginStatus | null;
  active: boolean;
  onUse: () => void;
}) {
  const queryClient = useQueryClient();
  const logout = useMutation(
    trpc.kubernetes.logout.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries(),
    }),
  );
  const canLogIn = row.auth === "token" || row.auth === "none" || row.auth === "certificate";
  const loggedIn = row.auth === "token" && status?.state !== "logged-out";

  return (
    <EntityRow
      className="border-b border-border/45 px-3.5"
      label={<span className="text-[12.5px]">{row.name}</span>}
      detail={`${kubeUserLabel(row.userName) || "-"} · ${row.namespace ?? "default"}`}
      badges={
        <>
          {active ? <Badge tone="primary">in view</Badge> : null}
          {row.current ? <Badge tone="info">kubeconfig default</Badge> : null}
          {row.execPlugin ? (
            <Badge
              tone="warning"
              title={`Running \`${row.execPlugin}\` gets this context's credentials. It runs inside your own kubectl, not from faws.`}
            >
              plugin {row.execPlugin}
            </Badge>
          ) : null}
          <LoginBadge row={row} status={status} />
        </>
      }
      actions={
        <span className="flex items-center gap-1.5">
          {logout.isError ? (
            <span
              className="max-w-60 truncate text-[11px] text-danger"
              title={logout.error.message}
            >
              {logout.error.message}
            </span>
          ) : null}
          {active ? null : (
            <Button size="xs" onClick={onUse} title="Point the Kubernetes pages at this context">
              Use
            </Button>
          )}
          {canLogIn ? (
            <Button
              size="xs"
              variant={
                status?.state === "expired" || status?.state === "logged-out"
                  ? "default"
                  : "outline"
              }
              onClick={() => openKubeLogin(row.name)}
            >
              {status?.state === "logged-out" ? "Log in" : "Log in again"}
            </Button>
          ) : null}
          {loggedIn ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={logout.isPending}
              onClick={() => logout.mutate({ context: row.name })}
              title="Revoke this token on the cluster and remove it from your kubeconfig"
            >
              Log out
            </Button>
          ) : null}
        </span>
      }
    />
  );
}

function LoginBadge({ row, status }: { row: KubeContextInfo; status: KubeLoginStatus | null }) {
  const now = useClock();
  if (row.auth === "certificate") return <Badge>client certificate</Badge>;
  if (!status) return null;
  switch (status.state) {
    case "expired":
      return <Badge tone="danger">expired</Badge>;
    case "logged-out":
      return <Badge tone="neutral">logged out</Badge>;
    case "valid":
      return (
        <Badge tone="success" title={status.expiresAt ?? undefined}>
          {status.expiresAt ? `expires ${relativeTime(status.expiresAt, now)}` : "logged in"}
        </Badge>
      );
    case "unknown":
      return null;
  }
}
