import {
  GetResourcesCommand,
  type Integration,
  type Method,
  type Resource,
} from "@aws-sdk/client-api-gateway";
import type {
  AwsScope,
  RestApiIntegration,
  RestApiMethod,
  RestApiResource,
  RestApiResourceListing,
} from "@faws/contracts";

import { apiGatewayClient, callAws, collectPagesUpTo } from "../../clients.ts";

/** GetResources returns at most 500 a page; the default quota is 300 resources an API. */
const MAX_RESOURCE_PAGES = 20;

/** The order methods are read in, which is not the alphabet. */
const METHOD_ORDER = ["ANY", "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function methodRank(httpMethod: string): number {
  const rank = METHOD_ORDER.indexOf(httpMethod);
  return rank === -1 ? METHOD_ORDER.length : rank;
}

function restApiIntegration(integration: Integration): RestApiIntegration {
  return {
    type: integration.type ?? null,
    httpMethod: integration.httpMethod ?? null,
    uri: integration.uri || null,
    connectionType: integration.connectionType ?? null,
    connectionId: integration.connectionId || null,
    credentials: integration.credentials || null,
    timeoutMs: integration.timeoutInMillis ?? null,
    passthroughBehavior: integration.passthroughBehavior ?? null,
    cacheKeyParameters: integration.cacheKeyParameters ?? [],
  };
}

function restApiMethod(httpMethod: string, method: Method): RestApiMethod {
  return {
    httpMethod: method.httpMethod ?? httpMethod,
    authorizationType: method.authorizationType ?? null,
    authorizerId: method.authorizerId || null,
    apiKeyRequired: method.apiKeyRequired ?? false,
    operationName: method.operationName || null,
    requestParameters: method.requestParameters ?? {},
    integration: method.methodIntegration ? restApiIntegration(method.methodIntegration) : null,
  };
}

/** A listed resource with its methods in reading order, or `null` for one without an id. */
export function restApiResource(resource: Resource): RestApiResource | null {
  if (!resource.id) return null;
  const methods = Object.entries(resource.resourceMethods ?? {})
    .map(([httpMethod, method]) => restApiMethod(httpMethod, method))
    .toSorted(
      (a, b) =>
        methodRank(a.httpMethod) - methodRank(b.httpMethod) ||
        a.httpMethod.localeCompare(b.httpMethod),
    );
  return {
    id: resource.id,
    parentId: resource.parentId ?? null,
    path: resource.path ?? "/",
    pathPart: resource.pathPart ?? null,
    methods,
  };
}

/**
 * Every resource of one REST API, with its methods and their integrations
 * embedded, so the whole tree is one listing rather than a call per method.
 */
export async function listResources(
  scope: AwsScope,
  apiId: string,
): Promise<RestApiResourceListing> {
  const client = apiGatewayClient(scope);
  const { items, truncated } = await collectPagesUpTo(MAX_RESOURCE_PAGES, async (position) => {
    const page = await callAws("apigateway", () =>
      client.send(
        new GetResourcesCommand({
          restApiId: apiId,
          embed: ["methods"],
          limit: 500,
          ...(position ? { position } : {}),
        }),
      ),
    );
    return { items: page.items ?? [], ...(page.position ? { nextToken: page.position } : {}) };
  });

  return { resources: items.flatMap((item) => restApiResource(item) ?? []), truncated };
}
