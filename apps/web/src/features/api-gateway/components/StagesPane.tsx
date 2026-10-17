import type { RestApiDetail, RestApiMethodSetting, RestApiStage } from "@faws/contracts";
import { relativeTime } from "@faws/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Layers } from "lucide-react";

import { KeyValue, KeyValueGrid } from "~/components/kv";
import { Badge } from "~/components/ui/badge";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { SectionHeader } from "~/components/ui/section-header";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import {
  linkClass,
  TagsSection,
  useStageLogSources,
} from "~/features/api-gateway/components/parts";
import { invokeUrl, type StageLogKind } from "~/features/api-gateway/stages";
import { limitsLabel, plansForStage, quotaLabel } from "~/features/api-gateway/usage-plans";
import { parseText, useSearchState, withoutListSearch } from "~/hooks/useSearchState";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

/**
 * The API's stages down the side, and how the picked one is set up on the
 * right. The picked stage rides in the URL by name, so a link lands on it.
 */
export function StagesPane({ api }: { api: RestApiDetail }) {
  const scope = useAwsScope();
  const [picked, setPicked] = useSearchState<string>({
    key: "stage",
    fallback: "",
    parse: parseText,
  });

  const stages = useQuery(trpc.apiGateway.stages.queryOptions({ ...scope, apiId: api.id }));

  if (stages.isPending) return <LoadingRows rows={8} />;
  if (stages.isError) {
    return <ErrorState error={stages.error} onRetry={() => void stages.refetch()} />;
  }
  if (stages.data.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="This API has no stages"
        hint="It cannot be called until a deployment is put on a stage."
      />
    );
  }

  const selected = stages.data.find((stage) => stage.name === picked) ?? stages.data[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Stages" className="flex w-52 shrink-0 flex-col border-r border-border">
        <div className="min-h-0 flex-1 overflow-auto">
          {stages.data.map((stage) => {
            const active = stage.name === selected?.name;
            return (
              <button
                key={stage.name}
                type="button"
                onClick={() => setPicked(stage.name)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-0.5 border-b border-border/50 px-3 py-1.5 text-left transition-colors",
                  active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {stage.name}
                  </span>
                  {stage.canary ? <Badge tone="info">canary</Badge> : null}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/80">
                  {stage.deploymentId ?? "no deployment"}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {selected ? <StageDetail api={api} stage={selected} /> : null}
      </div>
    </div>
  );
}

function StageDetail({ api, stage }: { api: RestApiDetail; stage: RestApiStage }) {
  const { region } = useScope();
  const url = invokeUrl(api.id, region, stage.name);
  const variables = Object.entries(stage.variables).toSorted(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
        <span className="min-w-0 truncate font-mono text-[12.5px] text-foreground">
          {stage.name}
        </span>
        {stage.tracingEnabled ? <Badge tone="info">x-ray</Badge> : null}
        {stage.cacheClusterEnabled ? <Badge>cache</Badge> : null}
      </div>

      <section className="flex flex-col gap-2 border-b border-border px-3.5 py-3">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 font-mono text-[12px] break-all">{url}</span>
          <CopyButton variant="ghost" size="icon" label="invoke URL" value={url} />
        </div>
        {api.disableExecuteApiEndpoint ? (
          <p className="text-[11.5px] text-warning">
            The default endpoint is disabled, so this URL refuses calls; the API is reached through
            a custom domain.
          </p>
        ) : api.endpointTypes.includes("PRIVATE") ? (
          <p className="text-[11.5px] text-muted-foreground">
            A private API: this URL answers only from inside a VPC with an execute-api endpoint.
          </p>
        ) : null}

        <KeyValueGrid>
          <KeyValue label="Deployment">{stage.deploymentId ?? "-"}</KeyValue>
          <KeyValue label="Description" mono={false}>
            {stage.description ?? "-"}
          </KeyValue>
          <KeyValue label="Created">
            <span title={fullTimestamp(stage.createdAt)}>{relativeTime(stage.createdAt)}</span>
          </KeyValue>
          <KeyValue label="Updated">
            <span title={fullTimestamp(stage.updatedAt)}>{relativeTime(stage.updatedAt)}</span>
          </KeyValue>
          <KeyValue label="Cache cluster">{cacheLabel(stage)}</KeyValue>
          <KeyValue label="X-Ray tracing">{stage.tracingEnabled ? "on" : "off"}</KeyValue>
          <KeyValue label="Client certificate">{stage.clientCertificateId ?? "-"}</KeyValue>
          <KeyValue label="Documentation version">{stage.documentationVersion ?? "-"}</KeyValue>
          <KeyValue label="WAF web ACL" className="col-span-full">
            <span className="break-all">{stage.webAclArn ?? "-"}</span>
          </KeyValue>
          <KeyValue label="Execution logs" className="col-span-full">
            <LogDestination apiId={api.id} stage={stage} kind="execution" />
          </KeyValue>
          <KeyValue label="Access logs" className="col-span-full">
            <LogDestination apiId={api.id} stage={stage} kind="access" />
          </KeyValue>
          {stage.accessLog?.format ? (
            <KeyValue label="Access log format" className="col-span-full">
              <span className="break-all whitespace-pre-wrap">{stage.accessLog.format}</span>
            </KeyValue>
          ) : null}
        </KeyValueGrid>
      </section>

      {variables.length > 0 ? (
        <section className="flex flex-col gap-2 border-b border-border px-3.5 py-3">
          <SectionHeader title="Stage variables" count={variables.length} />
          <KeyValueGrid>
            {variables.map(([name, value]) => (
              <KeyValue key={name} label={name}>
                <span className="break-all">{value}</span>
              </KeyValue>
            ))}
          </KeyValueGrid>
        </section>
      ) : null}

      {stage.canary ? <CanaryDetail canary={stage.canary} /> : null}

      <section className="flex flex-col gap-2 border-b border-border px-3.5 py-3">
        <SectionHeader title="Method settings" count={stage.methodSettings.length} />
        {stage.methodSettings.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            None set: every method runs with logging, metrics and caching off, under the default
            account throttling.
          </p>
        ) : (
          stage.methodSettings.map((setting) => (
            <MethodSettingDetail
              key={`${setting.resourcePath} ${setting.httpMethod}`}
              setting={setting}
            />
          ))
        )}
      </section>

      <StageUsagePlans apiId={api.id} stageName={stage.name} />

      <TagsSection tags={stage.tags} className="border-b border-border py-3" />
    </div>
  );
}

/** The usage plans that meter this stage, read from the region's whole plan listing. */
function StageUsagePlans({ apiId, stageName }: { apiId: string; stageName: string }) {
  const scope = useAwsScope();
  const plans = useQuery(trpc.apiGateway.usagePlans.queryOptions(scope));
  const matches = plans.data ? plansForStage(plans.data.plans, apiId, stageName) : [];

  return (
    <section className="flex flex-col gap-2 border-b border-border px-3.5 py-3">
      <SectionHeader
        title="Usage plans"
        count={plans.data ? `${matches.length}${plans.data.truncated ? "+" : ""}` : undefined}
        action={plans.isFetching ? <Spinner className="size-3" /> : undefined}
      />
      {plans.isPending ? (
        <LoadingRows rows={2} />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
      ) : matches.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          {plans.data.truncated
            ? "None among the plans listed; this region has more than one listing covers."
            : "None: no usage plan meters this stage, so a method that requires an API key refuses every call."}
        </p>
      ) : (
        matches.map(({ plan, apiStage }) => (
          <div
            key={plan.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/70 px-3 py-2 text-[12px]"
          >
            <Link to="/api-gateway/usage-plans" search={{ plan: plan.id }} className={linkClass}>
              {plan.name}
              <span className="font-mono text-[11px] text-muted-foreground">{plan.id}</span>
            </Link>
            <span className="font-mono text-[11.5px] text-muted-foreground">
              throttle {limitsLabel(plan.throttle)} · quota {quotaLabel(plan.quota)}
            </span>
            {apiStage.methodThrottles.length > 0 ? (
              <span className="font-mono text-[11px] text-muted-foreground">
                {apiStage.methodThrottles.length} method{" "}
                {apiStage.methodThrottles.length === 1 ? "throttle" : "throttles"}
              </span>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}

/**
 * Where one of the stage's logs goes. A log group faws can read links to its
 * CloudWatch page and to the logs tab; one elsewhere, or a Firehose stream,
 * is shown as its ARN.
 */
function LogDestination({
  apiId,
  stage,
  kind,
}: {
  apiId: string;
  stage: RestApiStage;
  kind: StageLogKind;
}) {
  const sources = useStageLogSources(apiId, stage);
  const source = sources[kind];
  if (source.kind === "off") return <>off</>;
  if (source.kind !== "group") return <span className="break-all">{source.arn}</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <Link
        to="/cloudwatch/log-groups/$group"
        params={{ group: source.name }}
        className={linkClass}
        {...("arn" in source ? { title: source.arn } : {})}
      >
        {source.name} <ArrowUpRight className="size-3 shrink-0" />
      </Link>
      <Link
        to="/api-gateway/rest-apis/$apiId"
        params={{ apiId }}
        search={(prev) => ({
          ...withoutListSearch(prev),
          tab: "logs",
          stage: stage.name,
          log: kind,
        })}
        className={linkClass}
      >
        read in Logs
      </Link>
    </span>
  );
}

function CanaryDetail({ canary }: { canary: NonNullable<RestApiStage["canary"]> }) {
  const overrides = Object.entries(canary.stageVariableOverrides).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <section className="flex flex-col gap-2 border-b border-border px-3.5 py-3">
      <SectionHeader title="Canary" />
      <KeyValueGrid>
        <KeyValue label="Traffic">
          {canary.percentTraffic === null ? "-" : `${canary.percentTraffic}%`}
        </KeyValue>
        <KeyValue label="Deployment">{canary.deploymentId ?? "-"}</KeyValue>
        <KeyValue label="Stage cache">{canary.useStageCache ? "shared" : "not used"}</KeyValue>
        {overrides.map(([name, value]) => (
          <KeyValue key={name} label={`${name} (override)`}>
            <span className="break-all">{value}</span>
          </KeyValue>
        ))}
      </KeyValueGrid>
    </section>
  );
}

function MethodSettingDetail({ setting }: { setting: RestApiMethodSetting }) {
  const everything = setting.resourcePath === "*" && setting.httpMethod === "*";
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/70 px-3 py-2">
      <div className="flex items-center gap-2">
        {everything ? (
          <span className="font-mono text-[12px]">every method</span>
        ) : (
          <>
            <Badge tone="primary">{setting.httpMethod === "*" ? "all" : setting.httpMethod}</Badge>
            <span className="min-w-0 font-mono text-[12px] break-all">
              {setting.resourcePath === "*" ? "every path" : setting.resourcePath}
            </span>
          </>
        )}
      </div>
      <KeyValueGrid>
        <KeyValue label="Logging">{setting.loggingLevel ?? "OFF"}</KeyValue>
        <KeyValue label="Data trace">{setting.dataTraceEnabled ? "on" : "off"}</KeyValue>
        <KeyValue label="Detailed metrics">{setting.metricsEnabled ? "on" : "off"}</KeyValue>
        <KeyValue label="Throttling">
          {limitsLabel({
            rateLimit: setting.throttlingRateLimit,
            burstLimit: setting.throttlingBurstLimit,
          })}
        </KeyValue>
        <KeyValue label="Caching">{cachingLabel(setting)}</KeyValue>
      </KeyValueGrid>
    </div>
  );
}

function cacheLabel(stage: RestApiStage): string {
  if (!stage.cacheClusterEnabled) return "off";
  const size = stage.cacheClusterSize ? `${stage.cacheClusterSize} GB` : "on";
  return stage.cacheClusterStatus ? `${size} · ${stage.cacheClusterStatus}` : size;
}

function cachingLabel(setting: RestApiMethodSetting): string {
  if (!setting.cachingEnabled) return "off";
  const ttl = setting.cacheTtlSeconds === null ? "on" : `${setting.cacheTtlSeconds} s ttl`;
  return setting.cacheDataEncrypted ? `${ttl}, encrypted` : ttl;
}
