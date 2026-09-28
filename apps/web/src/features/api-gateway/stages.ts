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
 * The region and name of the log group an ARN names, or `null` when it names
 * something else, such as a Firehose stream. A trailing `:*` is allowed.
 */
export function logGroupFromArn(arn: string): { region: string; name: string } | null {
  const parts = arn.split(":");
  if (parts.length < 7 || parts[0] !== "arn" || parts[2] !== "logs") return null;
  if (parts[5] !== "log-group") return null;
  const tail = parts.slice(6);
  if (tail.at(-1) === "*") tail.pop();
  const name = tail.join(":");
  const region = parts[3] ?? "";
  return name && region ? { region, name } : null;
}

/** Whether any of the stage's methods write execution logs. */
export function executionLoggingOn(stage: RestApiStage): boolean {
  return stage.methodSettings.some(
    (setting) => setting.loggingLevel !== null && setting.loggingLevel !== "OFF",
  );
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
