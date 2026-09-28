import { GetStagesCommand, type MethodSetting, type Stage } from "@aws-sdk/client-api-gateway";
import type { AwsScope, RestApiMethodSetting, RestApiStage } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { apiGatewayClient, callAws } from "../../clients.ts";

/**
 * Splits a method setting's key, `{resource_path}/{http_method}`, into its
 * path and method.
 *
 * The path's own slashes arrive escaped as `~1`, so the method is whatever
 * follows the last real slash. `*` stands for every path or every method.
 */
export function methodSettingTarget(key: string): { resourcePath: string; httpMethod: string } {
  const cut = key.lastIndexOf("/");
  if (cut === -1) return { resourcePath: key, httpMethod: "*" };
  const rawPath = key.slice(0, cut);
  const httpMethod = key.slice(cut + 1) || "*";
  if (rawPath === "*") return { resourcePath: "*", httpMethod };
  const path = rawPath.replaceAll("~1", "/");
  return { resourcePath: path.startsWith("/") ? path : `/${path}`, httpMethod };
}

export function restApiMethodSetting(key: string, setting: MethodSetting): RestApiMethodSetting {
  return {
    ...methodSettingTarget(key),
    loggingLevel: setting.loggingLevel ?? null,
    dataTraceEnabled: setting.dataTraceEnabled ?? false,
    metricsEnabled: setting.metricsEnabled ?? false,
    throttlingBurstLimit: setting.throttlingBurstLimit ?? null,
    throttlingRateLimit: setting.throttlingRateLimit ?? null,
    cachingEnabled: setting.cachingEnabled ?? false,
    cacheTtlSeconds: setting.cacheTtlInSeconds ?? null,
    cacheDataEncrypted: setting.cacheDataEncrypted ?? false,
  };
}

function settingOrder(a: RestApiMethodSetting, b: RestApiMethodSetting): number {
  const wide = Number(b.resourcePath === "*") - Number(a.resourcePath === "*");
  return (
    wide || a.resourcePath.localeCompare(b.resourcePath) || a.httpMethod.localeCompare(b.httpMethod)
  );
}

/** A listed stage as its tab shows it, or `null` for one without a name. */
export function restApiStage(stage: Stage): RestApiStage | null {
  if (!stage.stageName) return null;
  const canary = stage.canarySettings;
  const destinationArn = stage.accessLogSettings?.destinationArn;
  return {
    name: stage.stageName,
    deploymentId: stage.deploymentId || null,
    description: stage.description || null,
    createdAt: toIso(stage.createdDate),
    updatedAt: toIso(stage.lastUpdatedDate),
    variables: stage.variables ?? {},
    cacheClusterEnabled: stage.cacheClusterEnabled ?? false,
    cacheClusterSize: stage.cacheClusterSize ?? null,
    cacheClusterStatus: stage.cacheClusterStatus ?? null,
    tracingEnabled: stage.tracingEnabled ?? false,
    webAclArn: stage.webAclArn || null,
    clientCertificateId: stage.clientCertificateId || null,
    documentationVersion: stage.documentationVersion || null,
    accessLog: destinationArn
      ? { destinationArn, format: stage.accessLogSettings?.format || null }
      : null,
    canary: canary
      ? {
          percentTraffic: canary.percentTraffic ?? null,
          deploymentId: canary.deploymentId || null,
          stageVariableOverrides: canary.stageVariableOverrides ?? {},
          useStageCache: canary.useStageCache ?? false,
        }
      : null,
    methodSettings: Object.entries(stage.methodSettings ?? {})
      .map(([key, setting]) => restApiMethodSetting(key, setting))
      .toSorted(settingOrder),
    tags: stage.tags ?? {},
  };
}

/** Every stage of one REST API, by name. GetStages is not paged. */
export async function listStages(scope: AwsScope, apiId: string): Promise<RestApiStage[]> {
  const client = apiGatewayClient(scope);
  const page = await callAws("apigateway", () =>
    client.send(new GetStagesCommand({ restApiId: apiId })),
  );
  return (page.item ?? [])
    .map(restApiStage)
    .filter((stage) => stage !== null)
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
