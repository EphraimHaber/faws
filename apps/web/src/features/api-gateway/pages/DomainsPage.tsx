import type { CustomDomain } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { DomainPanel } from "~/features/api-gateway/components/DomainPanel";
import { dnsTarget, domainKey, statusTone } from "~/features/api-gateway/domains";
import { useFilterSearch, useSearchState } from "~/hooks/useSearchState";
import { trpc } from "~/lib/trpc";

/**
 * Every custom domain in the scoped region, and the base path mappings of the
 * one picked. The picked domain sits above the list and rides in the URL, so
 * the next domain along is one row down and a domain's mappings are a link.
 */
export function DomainsPage() {
  const scope = useAwsScope();
  const [filter, setFilter] = useFilterSearch();
  const [picked, setPicked] = useSearchState<string>({
    key: "domain",
    fallback: "",
    parse: (raw) => (typeof raw === "string" ? raw : ""),
  });

  const domains = useQuery(trpc.apiGateway.domainNames.queryOptions(scope));
  const rows = domains.data?.domains ?? [];
  const selected = rows.find((row) => domainKey(row) === picked) ?? null;

  const columns = React.useMemo<Column<CustomDomain>[]>(
    () => [
      {
        id: "name",
        header: "Domain",
        value: (row) => row.name,
        cell: (row) => (
          <span className="flex items-center gap-1.5">
            <span className="font-medium">{row.name}</span>
            {row.domainNameId ? (
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {row.domainNameId}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "endpoint",
        header: "Endpoint",
        width: "8rem",
        mono: true,
        value: (row) => row.endpointTypes.join(", "),
        cell: (row) => (row.endpointTypes.length === 0 ? "-" : row.endpointTypes.join(", ")),
      },
      {
        id: "target",
        header: "DNS target",
        mono: true,
        value: (row) => dnsTarget(row) ?? "",
        cell: (row) => <span className="text-muted-foreground">{dnsTarget(row) ?? "-"}</span>,
      },
      {
        id: "certificate",
        header: "Certificate",
        mono: true,
        value: (row) => row.certificateArn ?? "",
        cell: (row) => (
          <span className="text-[11px] text-muted-foreground">{row.certificateArn ?? "-"}</span>
        ),
      },
      {
        id: "security-policy",
        header: "Security policy",
        width: "10rem",
        mono: true,
        value: (row) => row.securityPolicy ?? "",
        cell: (row) => row.securityPolicy ?? "-",
      },
      {
        id: "status",
        header: "Status",
        width: "9rem",
        value: (row) => row.status ?? "",
        cell: (row) =>
          row.status ? (
            <Badge tone={statusTone(row.status)} title={row.statusMessage ?? undefined}>
              {row.status.replaceAll("_", " ")}
            </Badge>
          ) : (
            "-"
          ),
      },
    ],
    [],
  );

  if (domains.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={domains.error} onRetry={() => void domains.refetch()} />
      </Panel>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {picked && !domains.isPending ? (
        <DomainPanel domain={selected} domainKey={picked} onClose={() => setPicked("")} />
      ) : null}

      <Panel className="flex-1">
        <PanelHeader>
          <PanelTitle>Custom domains</PanelTitle>
          <span className="font-mono text-[11px] text-muted-foreground tabular">
            {domains.isPending ? "…" : rows.length}
          </span>
          {domains.data?.truncated ? (
            <span
              className="font-mono text-[10.5px] whitespace-nowrap text-warning"
              title="This region has more custom domains than one listing covers."
            >
              first {rows.length} only
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <FilterInput value={filter} onChange={setFilter} total={rows.length} />
          </div>
        </PanelHeader>

        {domains.isPending ? (
          <LoadingRows />
        ) : (
          <DataTable
            tableId="api-gateway-domains"
            rows={rows}
            columns={columns}
            rowKey={domainKey}
            onOpen={(row) => setPicked(domainKey(row))}
            filter={filter}
            onClearFilter={() => setFilter("")}
            emptyState={
              <EmptyState
                icon={Globe}
                title="No custom domains"
                hint="Every API in this region is called on its own execute-api URL, or the profile cannot list domains."
              />
            }
          />
        )}
      </Panel>
    </div>
  );
}
