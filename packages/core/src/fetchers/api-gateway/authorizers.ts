import { type Authorizer, GetAuthorizersCommand } from "@aws-sdk/client-api-gateway";
import type { AwsScope, RestApiAuthorizer, RestApiAuthorizerListing } from "@faws/contracts";

import { apiGatewayClient, callAws } from "../../clients.ts";

/** GetAuthorizers returns at most 500 a page, and an API may have only a few dozen. */
const MAX_AUTHORIZER_PAGES = 5;

/** A listed authorizer, or `null` for one without an id. */
export function restApiAuthorizer(authorizer: Authorizer): RestApiAuthorizer | null {
  if (!authorizer.id) return null;
  return {
    id: authorizer.id,
    name: authorizer.name || authorizer.id,
    type: authorizer.type ?? null,
    identitySource: authorizer.identitySource || null,
    identityValidationExpression: authorizer.identityValidationExpression || null,
    authorizerUri: authorizer.authorizerUri || null,
    credentials: authorizer.authorizerCredentials || null,
    resultTtlSeconds: authorizer.authorizerResultTtlInSeconds ?? null,
    providerArns: authorizer.providerARNs ?? [],
  };
}

/** Every authorizer of one REST API, by name. */
export async function listAuthorizers(
  scope: AwsScope,
  apiId: string,
): Promise<RestApiAuthorizerListing> {
  const client = apiGatewayClient(scope);
  const authorizers: RestApiAuthorizer[] = [];
  let position: string | undefined;
  let pages = 0;
  do {
    const page = await callAws("apigateway", () =>
      client.send(
        new GetAuthorizersCommand({
          restApiId: apiId,
          limit: 500,
          ...(position ? { position } : {}),
        }),
      ),
    );
    for (const item of page.items ?? []) {
      const authorizer = restApiAuthorizer(item);
      if (authorizer) authorizers.push(authorizer);
    }
    position = page.position;
    pages += 1;
  } while (position && pages < MAX_AUTHORIZER_PAGES);

  return {
    authorizers: authorizers.toSorted((a, b) => a.name.localeCompare(b.name)),
    truncated: Boolean(position),
  };
}
