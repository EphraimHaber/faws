import { GetRestApisCommand, type RestApi } from "@aws-sdk/client-api-gateway";
import type { AwsScope, RestApiListing, RestApiSummary } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { apiGatewayClient, callAws } from "../../clients.ts";

/** GetRestApis returns at most 500 a page; this many pages is 5,000 APIs. */
const MAX_API_PAGES = 10;

/** A listed API as the list shows it, or `null` for one without an id. */
export function restApiSummary(api: RestApi): RestApiSummary | null {
  if (!api.id) return null;
  return {
    id: api.id,
    name: api.name ?? api.id,
    description: api.description || null,
    createdAt: toIso(api.createdDate),
    version: api.version || null,
    endpointTypes: api.endpointConfiguration?.types ?? [],
    apiKeySource: api.apiKeySource ?? null,
  };
}

/**
 * Every REST API in the region, up to a cap.
 *
 * Collected rather than paged to the caller, because the list is filtered and
 * sorted as a whole on the page.
 */
export async function listRestApis(scope: AwsScope): Promise<RestApiListing> {
  const client = apiGatewayClient(scope);
  const apis: RestApiSummary[] = [];
  let position: string | undefined;
  let pages = 0;
  do {
    const page = await callAws("apigateway", () =>
      client.send(new GetRestApisCommand({ limit: 500, ...(position ? { position } : {}) })),
    );
    for (const api of page.items ?? []) {
      const summary = restApiSummary(api);
      if (summary) apis.push(summary);
    }
    position = page.position;
    pages += 1;
  } while (position && pages < MAX_API_PAGES);

  return { apis, truncated: Boolean(position) };
}
