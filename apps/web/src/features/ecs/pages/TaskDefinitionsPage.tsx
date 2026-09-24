import { useQuery } from "@tanstack/react-query";
import { FileJson } from "lucide-react";
import * as React from "react";

import { JsonViewer } from "~/components/JsonViewer";
import { PinButton } from "~/components/PinButton";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { taskDefinitionRef } from "~/features/ecs/refs";
import { cpuLabel, memoryLabel } from "~/lib/format";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";
import { parseText, useFilterSearch, useSearchState } from "~/hooks/useSearchState";
import {
  PIN_DROP_CLASS,
  pinnedFirst,
  usePinDrag,
  usePinnedRanks,
  useRecordVisit,
} from "~/stores/recents";

/**
 * Families on the left, the selected revision's JSON on the right.
 *
 * Reading a task definition is the one thing the terminal genuinely does
 * worse: it is a deep document, and paging it in a fixed-height pane loses
 * the structure. Here it stays scrollable next to the revision list.
 */
export function TaskDefinitionsPage() {
  const scope = useAwsScope();
  const [filter, setFilter] = useFilterSearch();
  // in the url so a link or a pin reopens the same family
  const [familyParam, setFamilyParam] = useSearchState<string>({
    key: "family",
    fallback: "",
    parse: parseText,
  });
  const family = familyParam || null;
  // no choice means "whichever revision is newest". tagged with its family so a
  // family change from the url (back button, a pin) drops it too.
  const [chosen, setChosen] = React.useState<{ family: string; arn: string } | null>(null);
  const chosenRevision = chosen && chosen.family === family ? chosen.arn : null;

  const target = React.useMemo(
    () => (family ? taskDefinitionRef(family, scope) : null),
    [family, scope],
  );
  useRecordVisit(target);

  const families = useQuery(trpc.ecs.taskDefinitionFamilies.queryOptions(scope));
  const revisions = useQuery({
    ...trpc.ecs.taskDefinitionRevisions.queryOptions({ ...scope, family: family ?? "" }),
    enabled: Boolean(family),
  });
  const revision = chosenRevision ?? revisions.data?.[0] ?? null;

  const definition = useQuery({
    ...trpc.ecs.taskDefinition.queryOptions({ ...scope, taskDefinition: revision ?? "" }),
    enabled: Boolean(revision),
  });

  const ranks = usePinnedRanks();
  const pinDrag = usePinDrag();
  const visible = React.useMemo(() => {
    const query = filter.trim().toLowerCase();
    const rows = families.data ?? [];
    const matching = query ? rows.filter((name) => name.toLowerCase().includes(query)) : rows;
    return pinnedFirst(matching, ranks, (name) => taskDefinitionRef(name, scope));
  }, [families.data, filter, ranks, scope]);

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
            <div
              key={name}
              {...pinDrag(taskDefinitionRef(name, scope))}
              className={cn(
                "group flex items-center rounded pr-0.5 transition-colors",
                PIN_DROP_CLASS,
                name === family
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              <button
                type="button"
                onClick={() => setFamilyParam(name)}
                className="min-w-0 flex-1 cursor-pointer truncate px-2 py-1.5 text-left font-mono text-[12px]"
              >
                {name}
              </button>
              <PinButton quiet target={taskDefinitionRef(name, scope)} />
            </div>
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
                  onClick={() => family && setChosen({ family, arn })}
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
              {target ? <PinButton target={target} /> : null}
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
