import {
  type ApiStage,
  GetUsagePlanKeysCommand,
  GetUsagePlansCommand,
  type QuotaSettings,
  type ThrottleSettings,
  type UsagePlan as AwsUsagePlan,
  type UsagePlanKey as AwsUsagePlanKey,
} from "@aws-sdk/client-api-gateway";
import type {
  AwsScope,
  ThrottleLimits,
  UsagePlan,
  UsagePlanApiStage,
  UsagePlanKey,
  UsagePlanKeyListing,
  UsagePlanListing,
  UsagePlanQuota,
} from "@faws/contracts";

import { apiGatewayClient, callAws, collectPagesUpTo } from "../../clients.ts";
import { nullIfNotFound } from "./notFound.ts";
import { methodSettingTarget } from "./stages.ts";

/** GetUsagePlans returns at most 500 a page; a region rarely holds this many. */
const MAX_PLAN_PAGES = 10;

/** GetUsagePlanKeys returns at most 500 a page. */
const MAX_PLAN_KEY_PAGES = 10;

/** A throttle, or `null` when it sets neither limit. */
export function throttleLimits(throttle: ThrottleSettings | undefined): ThrottleLimits | null {
  const rateLimit = throttle?.rateLimit ?? null;
  const burstLimit = throttle?.burstLimit ?? null;
  if (rateLimit === null && burstLimit === null) return null;
  return { rateLimit, burstLimit };
}

/** A quota, or `null` when it sets no limit. */
export function usagePlanQuota(quota: QuotaSettings | undefined): UsagePlanQuota | null {
  if (!quota || quota.limit === undefined) return null;
  return { limit: quota.limit, period: quota.period ?? null, offset: quota.offset ?? null };
}

/** A plan's stage, or `null` for one missing its API or stage. */
function usagePlanApiStage(apiStage: ApiStage): UsagePlanApiStage | null {
  if (!apiStage.apiId || !apiStage.stage) return null;
  const methodThrottles = Object.entries(apiStage.throttle ?? {}).flatMap(([key, throttle]) => {
    const limits = throttleLimits(throttle);
    return limits ? [{ ...methodSettingTarget(key), throttle: limits }] : [];
  });
  return {
    apiId: apiStage.apiId,
    stage: apiStage.stage,
    methodThrottles: methodThrottles.toSorted(
      (a, b) =>
        a.resourcePath.localeCompare(b.resourcePath) || a.httpMethod.localeCompare(b.httpMethod),
    ),
  };
}

/** A listed plan, or `null` for one without an id. */
export function usagePlan(plan: AwsUsagePlan): UsagePlan | null {
  if (!plan.id) return null;
  return {
    id: plan.id,
    name: plan.name || plan.id,
    description: plan.description || null,
    throttle: throttleLimits(plan.throttle),
    quota: usagePlanQuota(plan.quota),
    apiStages: (plan.apiStages ?? []).flatMap((apiStage) => {
      const stage = usagePlanApiStage(apiStage);
      return stage ? [stage] : [];
    }),
    productCode: plan.productCode || null,
    tags: plan.tags ?? {},
  };
}

/**
 * A key on a plan, or `null` for one without an id. GetUsagePlanKeys sends
 * the key's value unasked; it is dropped here and goes no further.
 */
export function usagePlanKey(key: AwsUsagePlanKey): UsagePlanKey | null {
  if (!key.id) return null;
  return { id: key.id, name: key.name || null, type: key.type || null };
}

/** Every usage plan in the region, by name, up to a cap. */
export async function listUsagePlans(scope: AwsScope): Promise<UsagePlanListing> {
  const client = apiGatewayClient(scope);
  const { items, truncated } = await collectPagesUpTo(MAX_PLAN_PAGES, async (position) => {
    const page = await callAws("apigateway", () =>
      client.send(new GetUsagePlansCommand({ limit: 500, ...(position ? { position } : {}) })),
    );
    return { items: page.items ?? [], ...(page.position ? { nextToken: page.position } : {}) };
  });

  return {
    plans: items
      .flatMap((item) => usagePlan(item) ?? [])
      .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    truncated,
  };
}

/**
 * Every key on one usage plan, by name, or `null` when the region has no
 * such plan.
 */
export async function listUsagePlanKeys(
  scope: AwsScope,
  usagePlanId: string,
): Promise<UsagePlanKeyListing | null> {
  const client = apiGatewayClient(scope);
  const listed = await nullIfNotFound(() =>
    collectPagesUpTo(MAX_PLAN_KEY_PAGES, async (position) => {
      const page = await callAws("apigateway", () =>
        client.send(
          new GetUsagePlanKeysCommand({
            usagePlanId,
            limit: 500,
            ...(position ? { position } : {}),
          }),
        ),
      );
      return { items: page.items ?? [], ...(page.position ? { nextToken: page.position } : {}) };
    }),
  );
  if (!listed) return null;

  return {
    keys: listed.items
      .flatMap((item) => usagePlanKey(item) ?? [])
      .toSorted(
        (a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id) || a.id.localeCompare(b.id),
      ),
    truncated: listed.truncated,
  };
}
