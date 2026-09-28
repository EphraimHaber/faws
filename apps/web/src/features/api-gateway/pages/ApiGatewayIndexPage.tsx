import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";

import { SectionCard } from "~/components/section-card";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/** The front door of the API Gateway section. */
export function ApiGatewayIndexPage() {
  const scope = useAwsScope();
  const { region } = useScope();
  const apis = useQuery(trpc.apiGateway.restApis.queryOptions(scope));
  const count = apis.data?.apis.length ?? 0;

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>API Gateway</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">{region}</span>
      </PanelHeader>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <SectionCard
          to="/api-gateway/rest-apis"
          icon={Network}
          label="REST APIs"
          description="Every REST API in this region, with its endpoint type and where its keys are read from."
          metric={
            apis.isPending ? "…" : apis.isError ? "-" : `${count}${apis.data.truncated ? "+" : ""}`
          }
          metricLabel={count === 1 ? "API" : "APIs"}
        />
      </div>
    </Panel>
  );
}
