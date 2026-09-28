import { type Deployment, GetDeploymentsCommand } from "@aws-sdk/client-api-gateway";
import type { AwsScope, RestApiDeployment, RestApiDeploymentListing } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { apiGatewayClient, callAws, collectPagesUpTo } from "../../clients.ts";

/** GetDeployments returns at most 500 a page; an API rarely keeps this many. */
const MAX_DEPLOYMENT_PAGES = 20;

/** A listed deployment, or `null` for one without an id. */
export function restApiDeployment(deployment: Deployment): RestApiDeployment | null {
  if (!deployment.id) return null;
  return {
    id: deployment.id,
    description: deployment.description || null,
    createdAt: toIso(deployment.createdDate),
  };
}

/**
 * Every deployment of one REST API, newest first. AWS lists them in no
 * promised order, so they are all collected and sorted here.
 */
export async function listDeployments(
  scope: AwsScope,
  apiId: string,
): Promise<RestApiDeploymentListing> {
  const client = apiGatewayClient(scope);
  const { items, truncated } = await collectPagesUpTo(MAX_DEPLOYMENT_PAGES, async (position) => {
    const page = await callAws("apigateway", () =>
      client.send(
        new GetDeploymentsCommand({
          restApiId: apiId,
          limit: 500,
          ...(position ? { position } : {}),
        }),
      ),
    );
    return { items: page.items ?? [], ...(page.position ? { nextToken: page.position } : {}) };
  });

  return {
    deployments: items
      .flatMap((item) => restApiDeployment(item) ?? [])
      .toSorted((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    truncated,
  };
}
