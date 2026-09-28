import type { ApiKey, RestApiListing, UsagePlan } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Gauge, KeyRound } from "lucide-react";
import * as React from "react";

import { type Column, DataTable } from "~/components/data-table";
import { Segmented } from "~/components/segmented";
import { FilterInput } from "~/components/toolbar";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader } from "~/components/ui/panel";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useAwsScope } from "~/contexts/ScopeContext";
import { UsagePlanPanel } from "~/features/api-gateway/components/UsagePlanPanel";
import { limitsLabel, quotaLabel } from "~/features/api-gateway/usage-plans";
import { useFilterSearch, useSearchState } from "~/hooks/useSearchState";
import { useTabSearch } from "~/hooks/useTabSearch";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";

/** The tabs, in the order they are shown; the first is the default. */
export const USAGE_PLAN_TABS = ["plans", "keys"] as const;

type Tab = (typeof USAGE_PLAN_TABS)[number];

/**
 * Every usage plan and API key in the scoped region. The picked plan sits
 * above the list and rides in the URL, so a plan is a link. API keys are
 * listed without their values, which are never read.
 */
export function UsagePlansPage() {
  const scope = useAwsScope();
  const [tab, setTab] = useTabSearch(USAGE_PLAN_TABS, "plans");
  const [filter, setFilter] = useFilterSearch();
  const [picked, setPicked] = useSearchState<string>({
    key: "plan",
    fallback: "",
    parse: (raw) => (typeof raw === "string" ? raw : ""),
  });

  const plans = useQuery(trpc.apiGateway.usagePlans.queryOptions(scope));
  const keys = useQuery({
    ...trpc.apiGateway.apiKeys.queryOptions(scope),
    enabled: tab === "keys" || picked !== "",
  });
  const apis = useQuery({
    ...trpc.apiGateway.restApis.queryOptions(scope),
    enabled: tab === "plans",
  });

  const selected = plans.data?.plans.find((plan) => plan.id === picked) ?? null;
  const active = tab === "plans" ? plans : keys;
  const count = tab === "plans" ? plans.data?.plans.length : keys.data?.keys.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {picked && !plans.isPending && !plans.isError ? (
        <UsagePlanPanel
          plan={selected}
          planId={picked}
          apiKeys={keys.data}
          onClose={() => setPicked("")}
        />
      ) : null}

      <Panel className="flex-1">
        <PanelHeader>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "plans", label: "Usage plans", count: plans.data?.plans.length },
              { value: "keys", label: "API keys", count: keys.data?.keys.length },
            ]}
          />
          {active.data?.truncated ? (
            <span
              className="font-mono text-[10.5px] whitespace-nowrap text-warning"
              title={`This region has more ${tab === "plans" ? "usage plans" : "API keys"} than one listing covers.`}
            >
              first {count} only
            </span>
          ) : null}
          {tab === "keys" ? (
            <span className="text-[11px] text-muted-foreground">Key values are never read.</span>
          ) : null}
          {active.isFetching ? <Spinner /> : null}
          <div className="ml-auto flex items-center gap-2">
            <FilterInput value={filter} onChange={setFilter} total={count ?? 0} />
          </div>
        </PanelHeader>

        {tab === "plans" ? (
          plans.isError ? (
            <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
          ) : plans.isPending ? (
            <LoadingRows />
          ) : (
            <PlansTable
              plans={plans.data.plans}
              apis={apis.data}
              filter={filter}
              onClearFilter={() => setFilter("")}
              onOpen={(plan) => setPicked(plan.id)}
            />
          )
        ) : keys.isError ? (
          <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
        ) : keys.isPending ? (
          <LoadingRows />
        ) : (
          <KeysTable keys={keys.data.keys} filter={filter} onClearFilter={() => setFilter("")} />
        )}
      </Panel>
    </div>
  );
}

function PlansTable({
  plans,
  apis,
  filter,
  onClearFilter,
  onOpen,
}: {
  plans: ReadonlyArray<UsagePlan>;
  apis: RestApiListing | undefined;
  filter: string;
  onClearFilter: () => void;
  onOpen: (plan: UsagePlan) => void;
}) {
  const columns = React.useMemo<Column<UsagePlan>[]>(() => {
    const apiName = (apiId: string) => apis?.apis.find((api) => api.id === apiId)?.name ?? apiId;
    const stagesText = (plan: UsagePlan) =>
      plan.apiStages.map((stage) => `${apiName(stage.apiId)}/${stage.stage}`).join(", ");
    return [
      {
        id: "name",
        header: "Name",
        value: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      { id: "id", header: "Plan id", width: "8rem", mono: true, value: (row) => row.id },
      {
        id: "throttle",
        header: "Throttle",
        width: "10rem",
        mono: true,
        value: (row) => limitsLabel(row.throttle),
      },
      {
        id: "quota",
        header: "Quota",
        width: "10rem",
        mono: true,
        value: (row) => quotaLabel(row.quota),
      },
      {
        id: "stages",
        header: "API stages",
        value: stagesText,
        cell: (row) =>
          row.apiStages.length === 0 ? (
            <span className="text-muted-foreground">none</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {row.apiStages.map((stage) => (
                <Badge key={`${stage.apiId}/${stage.stage}`} title={stage.apiId}>
                  {apiName(stage.apiId)}/{stage.stage}
                </Badge>
              ))}
            </span>
          ),
      },
      {
        id: "description",
        header: "Description",
        value: (row) => row.description ?? "",
        cell: (row) => <span className="text-muted-foreground">{row.description ?? "-"}</span>,
      },
      {
        id: "product-code",
        header: "Marketplace product",
        width: "12rem",
        mono: true,
        defaultHidden: true,
        value: (row) => row.productCode ?? "",
        cell: (row) => row.productCode ?? "-",
      },
    ];
  }, [apis]);

  return (
    <DataTable
      tableId="api-gateway-usage-plans"
      rows={plans}
      columns={columns}
      rowKey={(row) => row.id}
      onOpen={onOpen}
      filter={filter}
      onClearFilter={onClearFilter}
      emptyState={
        <EmptyState
          icon={Gauge}
          title="No usage plans"
          hint="No API in this region meters its callers by key, or the profile cannot list plans."
        />
      }
    />
  );
}

function KeysTable({
  keys,
  filter,
  onClearFilter,
}: {
  keys: ReadonlyArray<ApiKey>;
  filter: string;
  onClearFilter: () => void;
}) {
  const columns = React.useMemo<Column<ApiKey>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        value: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      },
      { id: "id", header: "Key id", width: "9rem", mono: true, value: (row) => row.id },
      {
        id: "enabled",
        header: "Status",
        width: "7rem",
        value: (row) => (row.enabled ? "enabled" : "disabled"),
        cell: (row) =>
          row.enabled ? <Badge tone="success">enabled</Badge> : <Badge>disabled</Badge>,
      },
      {
        id: "description",
        header: "Description",
        value: (row) => row.description ?? "",
        cell: (row) => <span className="text-muted-foreground">{row.description ?? "-"}</span>,
      },
      {
        id: "stage-keys",
        header: "Stage keys",
        value: (row) => row.stageKeys.map((key) => `${key.apiId}/${key.stage}`).join(", "),
        cell: (row) =>
          row.stageKeys.length === 0 ? (
            <span className="text-muted-foreground">-</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {row.stageKeys.map((key) => (
                <Link
                  key={`${key.apiId}/${key.stage}`}
                  to="/api-gateway/rest-apis/$apiId"
                  params={{ apiId: key.apiId }}
                  search={{ tab: "stages", stage: key.stage }}
                  onClick={(event) => event.stopPropagation()}
                  className="font-mono text-[11px] underline decoration-border underline-offset-2 hover:text-primary"
                >
                  {key.apiId}/{key.stage}
                </Link>
              ))}
            </span>
          ),
      },
      {
        id: "customer",
        header: "Customer",
        width: "10rem",
        mono: true,
        defaultHidden: true,
        value: (row) => row.customerId ?? "",
        cell: (row) => row.customerId ?? "-",
      },
      {
        id: "created",
        header: "Created",
        width: "14rem",
        defaultHidden: true,
        value: (row) => row.createdAt ?? "",
        cell: (row) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {fullTimestamp(row.createdAt)}
          </span>
        ),
      },
      {
        id: "updated",
        header: "Updated",
        width: "8rem",
        align: "right",
        mono: true,
        value: (row) => row.updatedAt ?? "",
        cell: (row) => (
          <span className="text-muted-foreground" title={fullTimestamp(row.updatedAt)}>
            {relativeTime(row.updatedAt)}
          </span>
        ),
      },
      {
        id: "age",
        header: "Age",
        width: "8rem",
        align: "right",
        mono: true,
        value: (row) => row.createdAt ?? "",
        cell: (row) => <span className="text-muted-foreground">{relativeTime(row.createdAt)}</span>,
      },
    ],
    [],
  );

  return (
    <DataTable
      tableId="api-gateway-api-keys"
      rows={keys}
      columns={columns}
      rowKey={(row) => row.id}
      filter={filter}
      onClearFilter={onClearFilter}
      emptyState={
        <EmptyState
          icon={KeyRound}
          title="No API keys"
          hint="No caller in this region is issued a key, or the profile cannot list keys."
        />
      }
    />
  );
}
