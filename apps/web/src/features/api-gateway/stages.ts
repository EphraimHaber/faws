/**
 * Where a REST API stage is called and where it writes its logs, worked out
 * from its ids the way API Gateway names them, since no call returns them.
 */
import type { RestApiStage } from "@faws/contracts";

/** The default execute-api URL of one stage. China regions sit under their own domain. */
export function invokeUrl(apiId: string, region: string, stageName: string): string {
  const domain = region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
  return `https://${apiId}.execute-api.${region}.${domain}/${stageName}`;
}

/** The log group API Gateway writes a stage's execution logs to. */
export function executionLogGroup(apiId: string, stageName: string): string {
  return `API-Gateway-Execution-Logs_${apiId}/${stageName}`;
}

/**
 * The region, account and name of the log group an ARN names, or `null` when
 * it names something else, such as a Firehose stream. A trailing `:*` is
 * allowed.
 */
export function logGroupFromArn(
  arn: string,
): { region: string; account: string; name: string } | null {
  const parts = arn.split(":");
  if (parts.length < 7 || parts[0] !== "arn" || parts[2] !== "logs") return null;
  if (parts[5] !== "log-group") return null;
  const tail = parts.slice(6);
  if (tail.at(-1) === "*") tail.pop();
  const name = tail.join(":");
  const region = parts[3] ?? "";
  return name && region ? { region, account: parts[4] ?? "", name } : null;
}

/** Whether any of the stage's methods write execution logs. */
export function executionLoggingOn(stage: RestApiStage): boolean {
  return stage.methodSettings.some(
    (setting) => setting.loggingLevel !== null && setting.loggingLevel !== "OFF",
  );
}

/** The two logs a stage can write. */
export const STAGE_LOG_KINDS = ["access", "execution"] as const;

export type StageLogKind = (typeof STAGE_LOG_KINDS)[number];

/**
 * Where a stage's access logs go: nowhere, a log group faws can read in the
 * scoped region and account, a log group somewhere else, or a destination
 * that is not a log group at all, such as a Firehose stream.
 */
export type AccessLogSource =
  | { readonly kind: "off" }
  | { readonly kind: "group"; readonly name: string; readonly arn: string }
  | {
      readonly kind: "elsewhere";
      readonly name: string;
      readonly region: string;
      readonly account: string;
      readonly arn: string;
    }
  | { readonly kind: "not-cloudwatch"; readonly arn: string };

/**
 * Whether a stage writes execution logs, and the group they go to. The name
 * is there when logging is off too, since logs written while it was on stay.
 */
export type ExecutionLogSource =
  | { readonly kind: "off"; readonly name: string }
  | { readonly kind: "group"; readonly name: string };

export interface StageLogSources {
  readonly access: AccessLogSource;
  readonly execution: ExecutionLogSource;
}

/**
 * What there is to read of a stage's logs. `accountId` is the scoped
 * account, or `null` while unknown, in which case only the region tells a
 * group elsewhere from one here.
 */
export function stageLogSources(
  stage: RestApiStage,
  apiId: string,
  region: string,
  accountId: string | null,
): StageLogSources {
  const name = executionLogGroup(apiId, stage.name);
  return {
    access: accessLogSource(stage, region, accountId),
    execution: executionLoggingOn(stage) ? { kind: "group", name } : { kind: "off", name },
  };
}

function accessLogSource(
  stage: RestApiStage,
  region: string,
  accountId: string | null,
): AccessLogSource {
  if (!stage.accessLog) return { kind: "off" };
  const arn = stage.accessLog.destinationArn;
  const group = logGroupFromArn(arn);
  if (!group) return { kind: "not-cloudwatch", arn };
  const otherAccount = accountId !== null && group.account !== "" && group.account !== accountId;
  if (group.region !== region || otherAccount) return { kind: "elsewhere", ...group, arn };
  return { kind: "group", name: group.name, arn };
}

/** A stage serving a deployment, either as its main deployment or as its canary. */
export interface StageUse {
  readonly stage: string;
  readonly canary: boolean;
}

/** Each deployment id to the stages serving it, by stage name. */
export function stagesByDeployment(
  stages: ReadonlyArray<RestApiStage>,
): ReadonlyMap<string, ReadonlyArray<StageUse>> {
  const uses = new Map<string, StageUse[]>();
  const add = (deploymentId: string | null, use: StageUse) => {
    if (!deploymentId) return;
    const list = uses.get(deploymentId) ?? [];
    list.push(use);
    uses.set(deploymentId, list);
  };
  for (const stage of stages.toSorted((a, b) => a.name.localeCompare(b.name))) {
    add(stage.deploymentId, { stage: stage.name, canary: false });
    add(stage.canary?.deploymentId ?? null, { stage: stage.name, canary: true });
  }
  return uses;
}
