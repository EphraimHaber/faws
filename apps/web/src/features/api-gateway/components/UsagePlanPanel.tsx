import type {
  ApiKeyListing,
  RestApiListing,
  UsagePlan,
  UsagePlanApiStage,
  UsagePlanKey,
} from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Gauge, X } from "lucide-react";

import { KeyValue, KeyValueGrid } from "~/components/kv";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { SectionHeader } from "~/components/ui/section-header";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useAwsScope } from "~/stores/scope";
import { linkClass, TagsSection } from "~/features/api-gateway/components/parts";
import { limitsLabel, quotaLabel } from "~/features/api-gateway/usage-plans";
import { trpc } from "~/lib/trpc";

/**
 * One usage plan: its limits, the API stages it meters, and the keys on it.
 * `plan` is `null` when the URL names a plan the region's listing does not
 * hold. `apiKeys` is the region's key listing, when it is in, used to say
 * whether each key on the plan is enabled.
 */
export function UsagePlanPanel({
  plan,
  planId,
  apiKeys,
  onClose,
}: {
  plan: UsagePlan | null;
  planId: string;
  apiKeys: ApiKeyListing | undefined;
  onClose: () => void;
}) {
  return (
    <Panel className="max-h-[60%] shrink-0">
      <PanelHeader>
        <PanelTitle className="truncate">{plan?.name ?? planId}</PanelTitle>
        {plan ? (
          <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
            {plan.id}
            <CopyButton variant="ghost" size="icon" label="plan id" value={plan.id} />
          </span>
        ) : null}
        {plan?.productCode ? <Badge tone="info">marketplace</Badge> : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close the usage plan"
          onClick={onClose}
          className="ml-auto"
        >
          <X className="size-3.5" />
        </Button>
      </PanelHeader>
      {plan ? (
        <PlanDetail plan={plan} apiKeys={apiKeys} />
      ) : (
        <EmptyState
          icon={Gauge}
          title="No such usage plan"
          hint={`This region has no usage plan ${planId}, or it has been deleted.`}
        />
      )}
    </Panel>
  );
}

function PlanDetail({ plan, apiKeys }: { plan: UsagePlan; apiKeys: ApiKeyListing | undefined }) {
  const scope = useAwsScope();
  const apis = useQuery(trpc.apiGateway.restApis.queryOptions(scope));

  return (
    <div className="flex min-h-0 flex-col overflow-auto">
      <section className="flex flex-col gap-2 px-3.5 py-3">
        <KeyValueGrid>
          <KeyValue label="Throttle">{limitsLabel(plan.throttle)}</KeyValue>
          <KeyValue label="Quota">{quotaLabel(plan.quota)}</KeyValue>
          {plan.quota?.offset ? (
            <KeyValue label="Quota offset">
              {`${plan.quota.offset.toLocaleString("en-US")} fewer in the first period`}
            </KeyValue>
          ) : null}
          <KeyValue label="Description" mono={false} className="col-span-2">
            {plan.description ?? "-"}
          </KeyValue>
          {plan.productCode ? (
            <KeyValue label="Marketplace product">{plan.productCode}</KeyValue>
          ) : null}
        </KeyValueGrid>
      </section>

      <section className="flex flex-col gap-2 px-3.5 pb-3">
        <SectionHeader
          title="API stages"
          count={plan.apiStages.length}
          action={apis.isFetching ? <Spinner className="size-3" /> : undefined}
        />
        {plan.apiStages.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            None: this plan meters no stage yet, so its keys are accepted nowhere.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {plan.apiStages.map((apiStage) => (
              <ApiStageRow
                key={`${apiStage.apiId}/${apiStage.stage}`}
                apiStage={apiStage}
                apis={apis.isError ? undefined : apis.data}
              />
            ))}
          </ul>
        )}
      </section>

      <PlanKeys planId={plan.id} apiKeys={apiKeys} />

      <TagsSection tags={plan.tags} />
    </div>
  );
}

function ApiStageRow({
  apiStage,
  apis,
}: {
  apiStage: UsagePlanApiStage;
  apis: RestApiListing | undefined;
}) {
  const api = apis?.apis.find((candidate) => candidate.id === apiStage.apiId);

  return (
    <li className="flex flex-col gap-1 rounded-md border border-border/70 px-3 py-2">
      <span className="flex flex-wrap items-center gap-2 text-[12px]">
        <Link
          to="/api-gateway/rest-apis/$apiId"
          params={{ apiId: apiStage.apiId }}
          search={{ tab: "stages", stage: apiStage.stage }}
          className={linkClass}
        >
          {api ? (
            <>
              {api.name}
              <span className="font-mono text-[11px] text-muted-foreground">{apiStage.apiId}</span>
            </>
          ) : (
            <span className="font-mono">{apiStage.apiId}</span>
          )}
        </Link>
        <Badge tone="success">{apiStage.stage}</Badge>
      </span>
      {apiStage.methodThrottles.map((method) => (
        <span
          key={`${method.resourcePath} ${method.httpMethod}`}
          className="flex items-center gap-2 pl-1 text-[11.5px]"
        >
          <Badge tone="primary">{method.httpMethod === "*" ? "all" : method.httpMethod}</Badge>
          <span className="min-w-0 font-mono break-all">{method.resourcePath}</span>
          <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-mono text-muted-foreground">{limitsLabel(method.throttle)}</span>
        </span>
      ))}
    </li>
  );
}

/** The keys on the plan, each linking to its row in the API keys list. */
function PlanKeys({ planId, apiKeys }: { planId: string; apiKeys: ApiKeyListing | undefined }) {
  const scope = useAwsScope();
  const keys = useQuery(
    trpc.apiGateway.usagePlanKeys.queryOptions({ ...scope, usagePlanId: planId }),
  );
  const count = keys.data?.keys.length;

  return (
    <section className="flex flex-col gap-2 px-3.5 pb-3">
      <SectionHeader
        title="API keys"
        count={count === undefined ? undefined : `${count}${keys.data?.truncated ? "+" : ""}`}
        action={keys.isFetching ? <Spinner className="size-3" /> : undefined}
      />
      <p className="text-[11px] text-muted-foreground">Key values are never read.</p>
      {keys.isPending ? (
        <LoadingRows rows={2} />
      ) : keys.isError ? (
        <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
      ) : keys.data === null ? (
        <p className="text-[12px] text-warning">This plan has been deleted since it was listed.</p>
      ) : keys.data.keys.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          None: no caller is issued a key on this plan yet.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {keys.data.keys.map((key) => (
            <PlanKeyChip
              key={key.id}
              planId={planId}
              planKey={key}
              enabled={apiKeys?.keys.find((candidate) => candidate.id === key.id)?.enabled}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PlanKeyChip({
  planId,
  planKey,
  enabled,
}: {
  planId: string;
  planKey: UsagePlanKey;
  enabled: boolean | undefined;
}) {
  return (
    <li className="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-[12px]">
      <Link
        to="/api-gateway/usage-plans"
        search={{ tab: "keys", q: planKey.id, plan: planId }}
        className={linkClass}
      >
        {planKey.name ?? planKey.id}
        <span className="font-mono text-[11px] text-muted-foreground">{planKey.id}</span>
      </Link>
      {enabled === false ? <Badge>disabled</Badge> : null}
    </li>
  );
}
