import type { ThrottleLimits, UsagePlan, UsagePlanApiStage, UsagePlanQuota } from "@faws/contracts";

/** A throttle as a rate and a burst, e.g. `100/s, burst 200`. */
export function limitsLabel(throttle: ThrottleLimits | null): string {
  if (!throttle) return "none";
  return `${throttle.rateLimit ?? "-"}/s, burst ${throttle.burstLimit ?? "-"}`;
}

/** A quota as a count per period, e.g. `10,000 a month`. */
export function quotaLabel(quota: UsagePlanQuota | null): string {
  if (!quota || quota.limit === null) return "none";
  const count = quota.limit.toLocaleString("en-US");
  return quota.period ? `${count} a ${quota.period.toLowerCase()}` : count;
}

/** The plans that meter one stage of one API, each with its entry for that stage. */
export function plansForStage(
  plans: ReadonlyArray<UsagePlan>,
  apiId: string,
  stage: string,
): { plan: UsagePlan; apiStage: UsagePlanApiStage }[] {
  return plans.flatMap((plan) => {
    const apiStage = plan.apiStages.find(
      (candidate) => candidate.apiId === apiId && candidate.stage === stage,
    );
    return apiStage ? [{ plan, apiStage }] : [];
  });
}
