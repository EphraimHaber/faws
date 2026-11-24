import { useQuery } from "@tanstack/react-query";
import { Globe, KeyRound, Network } from "lucide-react";

import { SectionCard } from "~/components/section-card";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useAwsScope, useScope } from "~/stores/scope";
import { trpc } from "~/lib/trpc";

/** The front door of the API Gateway section. */
export function ApiGatewayIndexPage() {
  const scope = useAwsScope();
  const { region } = useScope();
  const apis = useQuery(trpc.apiGateway.restApis.queryOptions(scope));
  const domains = useQuery(trpc.apiGateway.domainNames.queryOptions(scope));
  const plans = useQuery(trpc.apiGateway.usagePlans.queryOptions(scope));
  const count = apis.data?.apis.length ?? 0;
  const domainCount = domains.data?.domains.length ?? 0;
  const planCount = plans.data?.plans.length ?? 0;

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
        <SectionCard
          to="/api-gateway/domains"
          icon={Globe}
          label="Custom domains"
          description="The domain names APIs are called on, their certificates, and which API and stage each base path serves."
          metric={
            domains.isPending
              ? "…"
              : domains.isError
                ? "-"
                : `${domainCount}${domains.data.truncated ? "+" : ""}`
          }
          metricLabel={domainCount === 1 ? "domain" : "domains"}
        />
        <SectionCard
          to="/api-gateway/usage-plans"
          icon={KeyRound}
          label="Usage plans"
          description="The throttles and quotas callers are held to, the API stages each plan meters, and the API keys on it."
          metric={
            plans.isPending
              ? "…"
              : plans.isError
                ? "-"
                : `${planCount}${plans.data.truncated ? "+" : ""}`
          }
          metricLabel={planCount === 1 ? "plan" : "plans"}
        />
      </div>
    </Panel>
  );
}
