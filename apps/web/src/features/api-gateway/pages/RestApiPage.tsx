import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Waypoints } from "lucide-react";
import * as React from "react";

import { PinButton } from "~/components/PinButton";
import { Segmented } from "~/components/segmented";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { AuthorizersPane } from "~/features/api-gateway/components/AuthorizersPane";
import { DeploymentsPane } from "~/features/api-gateway/components/DeploymentsPane";
import { ExportPane } from "~/features/api-gateway/components/ExportPane";
import { MetricsPane } from "~/features/api-gateway/components/MetricsPane";
import { ResourcesPane } from "~/features/api-gateway/components/ResourcesPane";
import { RestApiOverview } from "~/features/api-gateway/components/RestApiOverview";
import { StagesPane } from "~/features/api-gateway/components/StagesPane";
import { restApiRef } from "~/features/api-gateway/refs";
import { useListTabSearch } from "~/hooks/useTabSearch";
import { trpc } from "~/lib/trpc";
import { useRecordVisit } from "~/stores/recents";

/** The tabs, in the order they are shown; the first is the default. */
export const REST_API_TABS = [
  "overview",
  "resources",
  "stages",
  "deployments",
  "authorizers",
  "export",
  "metrics",
] as const;

type Tab = (typeof REST_API_TABS)[number];

/**
 * One REST API: a header naming it, and tabs for each part of how it is set
 * up. Each tab reads only what it shows, and only once it is open.
 */
export function RestApiPage({ apiId }: { apiId: string }) {
  const scope = useAwsScope();
  const { region } = useScope();
  const [tab, setTab] = useListTabSearch(REST_API_TABS, "overview");

  const detail = useQuery(trpc.apiGateway.restApi.queryOptions({ ...scope, apiId }));
  const resources = useQuery({
    ...trpc.apiGateway.resources.queryOptions({ ...scope, apiId }),
    enabled: tab === "resources",
  });
  const stages = useQuery({
    ...trpc.apiGateway.stages.queryOptions({ ...scope, apiId }),
    enabled: tab === "stages" || tab === "deployments" || tab === "export" || tab === "metrics",
  });
  const deployments = useQuery({
    ...trpc.apiGateway.deployments.queryOptions({ ...scope, apiId }),
    enabled: tab === "deployments",
  });
  const authorizers = useQuery({
    ...trpc.apiGateway.authorizers.queryOptions({ ...scope, apiId }),
    enabled: tab === "authorizers",
  });

  // Recorded from the route, so an API that fails to load still counts as
  // somewhere you went; the name replaces the id once it arrives.
  const name = detail.data?.name ?? "";
  const target = React.useMemo(() => restApiRef({ id: apiId, name }, scope), [apiId, name, scope]);
  useRecordVisit(target);

  if (detail.isPending) {
    return (
      <Panel className="flex-1">
        <LoadingRows rows={10} />
      </Panel>
    );
  }
  if (detail.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </Panel>
    );
  }
  if (!detail.data) {
    return (
      <Panel className="flex-1">
        <EmptyState
          icon={Waypoints}
          title={`No REST API "${apiId}" in ${region}`}
          hint="It may have been deleted, or it lives in another region."
        />
      </Panel>
    );
  }

  const api = detail.data;
  const consoleUrl = `https://${region}.console.aws.amazon.com/apigateway/main/apis/${encodeURIComponent(api.id)}/resources?api=${encodeURIComponent(api.id)}&region=${region}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <Panel className="shrink-0">
        <PanelHeader>
          <PanelTitle className="truncate text-[13px] font-medium tracking-normal text-foreground normal-case">
            {api.name}
          </PanelTitle>
          <span className="font-mono text-[11px] text-muted-foreground">{api.id}</span>
          <CopyButton variant="ghost" size="icon" label="API id" value={api.id} />
          {api.endpointTypes.map((type) => (
            <Badge key={type} tone={type === "PRIVATE" ? "info" : "neutral"}>
              {type}
            </Badge>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            <PinButton target={target} />
            <Button
              onClick={() => window.open(consoleUrl, "_blank", "noopener")}
              title="Open in the AWS console"
            >
              <ExternalLink className="size-3" /> Console
            </Button>
          </div>
        </PanelHeader>
      </Panel>

      <Panel className="min-h-[22rem] flex-1">
        <PanelHeader>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: "Overview" },
              { value: "resources", label: "Resources", count: resources.data?.resources.length },
              { value: "stages", label: "Stages", count: stages.data?.length },
              {
                value: "deployments",
                label: "Deployments",
                count: deployments.data?.deployments.length,
              },
              {
                value: "authorizers",
                label: "Authorizers",
                count: authorizers.data?.authorizers.length,
              },
              { value: "export", label: "Export" },
              { value: "metrics", label: "Metrics" },
            ]}
          />
          {(tab === "resources" && resources.isFetching) ||
          (tab === "stages" && stages.isFetching) ||
          (tab === "deployments" && (deployments.isFetching || stages.isFetching)) ||
          (tab === "authorizers" && authorizers.isFetching) ||
          ((tab === "export" || tab === "metrics") && stages.isFetching) ? (
            <Spinner />
          ) : null}
        </PanelHeader>

        {tab === "overview" ? <RestApiOverview api={api} /> : null}
        {tab === "resources" ? <ResourcesPane apiId={api.id} /> : null}
        {tab === "stages" ? <StagesPane api={api} /> : null}
        {tab === "deployments" ? <DeploymentsPane apiId={api.id} /> : null}
        {tab === "authorizers" ? <AuthorizersPane apiId={api.id} /> : null}
        {tab === "export" ? <ExportPane apiId={api.id} /> : null}
        {tab === "metrics" ? <MetricsPane apiId={api.id} apiName={api.name} /> : null}
      </Panel>
    </div>
  );
}
