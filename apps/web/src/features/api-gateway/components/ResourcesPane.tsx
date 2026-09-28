import type { RestApiMethod, RestApiResource } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { FolderTree, Route } from "lucide-react";
import * as React from "react";

import { KeyValue, KeyValueGrid } from "~/components/kv";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { SectionHeader } from "~/components/ui/section-header";
import { LoadingRows } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import {
  buildResourceTree,
  type ResourceRow,
  resourceRows,
} from "~/features/api-gateway/resource-tree";
import { useFilterSearch, useSearchState } from "~/hooks/useSearchState";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

/**
 * The API's paths as a tree down the side, and what the picked one does on
 * the right. The picked path rides in the URL, keyed by resource id, so a link
 * lands on the same one.
 */
export function ResourcesPane({ apiId }: { apiId: string }) {
  const scope = useAwsScope();
  const [filter, setFilter] = useFilterSearch();
  const [picked, setPicked] = useSearchState<string>({
    key: "resource",
    fallback: "",
    parse: (raw) => (typeof raw === "string" ? raw : ""),
  });

  const listing = useQuery(trpc.apiGateway.resources.queryOptions({ ...scope, apiId }));
  const resources = listing.data?.resources;
  const tree = React.useMemo(() => buildResourceTree(resources ?? []), [resources]);
  const rows = React.useMemo(() => resourceRows(tree, filter), [tree, filter]);

  if (listing.isPending) return <LoadingRows rows={8} />;
  if (listing.isError) {
    return <ErrorState error={listing.error} onRetry={() => void listing.refetch()} />;
  }
  if (listing.data.resources.length === 0) {
    return <EmptyState icon={FolderTree} title="This API has no resources" />;
  }

  // With nothing picked, open on the first path that has a method, since the
  // root of most APIs has none.
  const selected =
    listing.data.resources.find((resource) => resource.id === picked) ??
    rows.find((row) => row.resource.methods.length > 0)?.resource ??
    rows[0]?.resource ??
    null;

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label="Resources"
        className="flex w-60 shrink-0 flex-col border-r border-border lg:w-80"
      >
        <div className="border-b border-border px-2.5 py-2">
          <FilterInput
            value={filter}
            onChange={setFilter}
            placeholder="Filter paths, methods, backends…"
            count={rows.filter((row) => row.matched).length}
            total={listing.data.resources.length}
          />
        </div>
        {listing.data.truncated ? (
          <p className="border-b border-border px-3 py-1.5 font-mono text-[10.5px] text-warning">
            first {listing.data.resources.length} resources only
          </p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <EmptyState icon={FolderTree} title="No path matches the filter" />
          ) : (
            rows.map((row) => (
              <TreeRow
                key={row.resource.id}
                row={row}
                active={row.resource.id === selected?.id}
                onClick={() => setPicked(row.resource.id)}
              />
            ))
          )}
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {selected ? <ResourceDetail resource={selected} /> : null}
      </div>
    </div>
  );
}

function TreeRow({
  row,
  active,
  onClick,
}: {
  row: ResourceRow;
  active: boolean;
  onClick: () => void;
}) {
  const { resource, depth, matched } = row;
  return (
    <button
      type="button"
      onClick={onClick}
      title={resource.path}
      aria-current={active ? "true" : undefined}
      style={{ paddingLeft: `${0.75 + depth * 0.875}rem` }}
      className={cn(
        "flex w-full cursor-pointer items-baseline gap-2 border-b border-border/50 py-1.5 pr-3 text-left transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
        !matched && "opacity-60",
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
        {resource.pathPart ? `/${resource.pathPart}` : resource.path}
      </span>
      <span className="flex shrink-0 gap-1 font-mono text-[9.5px] text-muted-foreground/80">
        {resource.methods.map((method) => (
          <span key={method.httpMethod}>{method.httpMethod}</span>
        ))}
      </span>
    </button>
  );
}

function ResourceDetail({ resource }: { resource: RestApiResource }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
        <span className="min-w-0 truncate font-mono text-[12.5px] text-foreground">
          {resource.path}
        </span>
        <CopyButton variant="ghost" size="icon" label="path" value={resource.path} />
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{resource.id}</span>
      </div>
      {resource.methods.length === 0 ? (
        <EmptyState
          icon={Route}
          title="No methods on this path"
          hint="It exists to hold the paths under it."
        />
      ) : (
        resource.methods.map((method) => <MethodDetail key={method.httpMethod} method={method} />)
      )}
    </div>
  );
}

function MethodDetail({ method }: { method: RestApiMethod }) {
  const parameters = Object.entries(method.requestParameters).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  const integration = method.integration;

  return (
    <section className="flex flex-col gap-2 border-b border-border px-3.5 py-3">
      <div className="flex items-center gap-2">
        <Badge tone="primary">{method.httpMethod}</Badge>
        {method.operationName ? (
          <span className="font-mono text-[12px]">{method.operationName}</span>
        ) : null}
        {method.apiKeyRequired ? <Badge tone="warning">api key</Badge> : null}
      </div>

      <KeyValueGrid>
        <KeyValue label="Authorization">{method.authorizationType ?? "-"}</KeyValue>
        <KeyValue label="Authorizer">{method.authorizerId ?? "-"}</KeyValue>
        <KeyValue label="API key">{method.apiKeyRequired ? "required" : "not required"}</KeyValue>
        <KeyValue label="Operation">{method.operationName ?? "-"}</KeyValue>
      </KeyValueGrid>

      {parameters.length > 0 ? (
        <>
          <SectionHeader title="Request parameters" count={parameters.length} />
          <ul className="flex flex-col gap-1">
            {parameters.map(([name, required]) => (
              <li key={name} className="flex items-center gap-2 font-mono text-[11.5px]">
                <span className="break-all">{name}</span>
                {required ? <Badge tone="warning">required</Badge> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <SectionHeader title="Integration" />
      {integration ? (
        <KeyValueGrid>
          <KeyValue label="Type">{integration.type ?? "-"}</KeyValue>
          <KeyValue label="Backend method">{integration.httpMethod ?? "-"}</KeyValue>
          <KeyValue label="Connection">
            {integration.connectionType ?? "-"}
            {integration.connectionId ? ` · ${integration.connectionId}` : ""}
          </KeyValue>
          <KeyValue label="Timeout">{timeoutLabel(integration.timeoutMs)}</KeyValue>
          <KeyValue label="URI" className="col-span-full">
            <span className="break-all">{integration.uri ?? "-"}</span>
          </KeyValue>
          <KeyValue label="Passthrough">{integration.passthroughBehavior ?? "-"}</KeyValue>
          <KeyValue label="Credentials" className="col-span-full sm:col-span-1">
            <span className="break-all">{integration.credentials ?? "-"}</span>
          </KeyValue>
          <KeyValue label="Cache key parameters" className="col-span-full">
            {integration.cacheKeyParameters.length === 0
              ? "-"
              : integration.cacheKeyParameters.join(", ")}
          </KeyValue>
        </KeyValueGrid>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          No integration: a request to this method has nowhere to go.
        </p>
      )}
    </section>
  );
}

function timeoutLabel(ms: number | null): string {
  if (ms === null) return "-";
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}
