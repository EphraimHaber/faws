import { useQuery } from "@tanstack/react-query";
import { FileJson } from "lucide-react";
import * as React from "react";

import { JsonViewer } from "~/components/JsonViewer";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { cpuLabel, memoryLabel } from "~/lib/format";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

/**
 * Families on the left, the selected revision's JSON on the right.
 *
 * Reading a task definition is the one thing the terminal genuinely does
 * worse: it is a deep document, and paging it in a fixed-height pane loses
 * the structure. Here it stays scrollable next to the revision list.
 */
export function TaskDefinitionsPage() {
  const scope = useAwsScope();
  const [filter, setFilter] = React.useState("");
  const [family, setFamily] = React.useState<string | null>(null);
  // null means "whichever revision is newest"; picking one pins it until the
  // family changes.
  const [pinnedRevision, setPinnedRevision] = React.useState<string | null>(null);

  const families = useQuery(trpc.ecs.taskDefinitionFamilies.queryOptions(scope));
  const revisions = useQuery({
    ...trpc.ecs.taskDefinitionRevisions.queryOptions({ ...scope, family: family ?? "" }),
    enabled: Boolean(family),
  });
  const revision = pinnedRevision ?? revisions.data?.[0] ?? null;

  const definition = useQuery({
    ...trpc.ecs.taskDefinition.queryOptions({ ...scope, taskDefinition: revision ?? "" }),
    enabled: Boolean(revision),
  });

  const visible = React.useMemo(() => {
    const query = filter.trim().toLowerCase();
    const rows = families.data ?? [];
    return query ? rows.filter((name) => name.toLowerCase().includes(query)) : rows;
  }, [families.data, filter]);

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <Panel className="w-72 shrink-0">
        <PanelHeader>
          <PanelTitle>Families</PanelTitle>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular">
            {families.data ? visible.length : "…"}
          </span>
        </PanelHeader>
        <div className="px-2.5 py-2">
          <FilterInput value={filter} onChange={setFilter} placeholder="Filter families…" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
          {families.isPending ? <LoadingRows rows={8} /> : null}
          {families.isError ? (
            <ErrorState error={families.error} onRetry={() => void families.refetch()} />
          ) : null}
          {visible.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                // Clearing the pin here is what stops the JSON pane showing a
                // revision belonging to the family you just left.
                setFamily(name);
                setPinnedRevision(null);
              }}
              className={cn(
                "w-full cursor-pointer truncate rounded px-2 py-1.5 text-left font-mono text-[12px] transition-colors",
                name === family
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="min-h-0 flex-1">
        <PanelHeader>
          <PanelTitle>{family ?? "Task definition"}</PanelTitle>
          <div className="flex flex-wrap items-center gap-1">
            {(revisions.data ?? []).slice(0, 12).map((arn) => {
              const label = arn.slice(arn.lastIndexOf(":") + 1);
              return (
                <button
                  key={arn}
                  type="button"
                  onClick={() => setPinnedRevision(arn)}
                  className={cn(
                    "cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors",
                    arn === revision
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  :{label}
                </button>
              );
            })}
            {(revisions.data?.length ?? 0) > 12 ? (
              <span
                className="font-mono text-[10.5px] text-muted-foreground"
                title={`${revisions.data?.length} revisions in total`}
              >
                +{(revisions.data?.length ?? 0) - 12}
              </span>
            ) : null}
          </div>
          {definition.data ? (
            <div className="ml-auto flex items-center gap-1.5">
              <CopyButton
                variant="ghost"
                size="icon"
                label="task definition JSON"
                value={() => JSON.stringify(definition.data?.document ?? {}, null, 2)}
              />
              <Badge>{definition.data.summary.networkMode ?? "-"}</Badge>
              <Badge>{cpuLabel(definition.data.summary.cpu)}</Badge>
              <Badge>{memoryLabel(definition.data.summary.memory)}</Badge>
              <Badge tone={definition.data.summary.status === "ACTIVE" ? "success" : "neutral"}>
                {definition.data.summary.status}
              </Badge>
            </div>
          ) : null}
        </PanelHeader>

        {!family ? (
          <EmptyState icon={FileJson} title="Pick a family to see its revisions" />
        ) : definition.isPending && revision ? (
          <LoadingRows rows={12} />
        ) : definition.isError ? (
          <ErrorState error={definition.error} onRetry={() => void definition.refetch()} />
        ) : definition.data ? (
          <div className="min-h-0 flex-1">
            <JsonViewer value={definition.data.document} />
          </div>
        ) : (
          <EmptyState icon={FileJson} title="No revisions for this family" />
        )}
      </Panel>
    </div>
  );
}
