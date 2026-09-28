import { GetRestApiCommand, type RestApi } from "@aws-sdk/client-api-gateway";
import { AwsRequestError, type AwsScope, type RestApiDetail } from "@faws/contracts";

import { apiGatewayClient, callAws } from "../../clients.ts";
import { restApiSummary } from "./restApis.ts";

/**
 * A resource policy as JSON text that parses.
 *
 * API Gateway hands the policy back with its quotes escaped, as the inside of
 * a JSON string rather than a document, so it is unescaped one level when it
 * does not parse as it stands. Text that parses neither way is returned as is.
 */
export function restApiPolicyText(raw: string | undefined): string | null {
  if (!raw) return null;
  if (parses(raw)) return raw;
  try {
    const unescaped = JSON.parse(`"${raw}"`) as string;
    if (parses(unescaped)) return unescaped;
  } catch {
    // Not an escaped document either; shown as it came.
  }
  return raw;
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** An API as its page shows it, or `null` for one without an id. */
export function restApiDetail(api: RestApi): RestApiDetail | null {
  const summary = restApiSummary(api);
  if (!summary) return null;
  return {
    ...summary,
    vpcEndpointIds: api.endpointConfiguration?.vpcEndpointIds ?? [],
    binaryMediaTypes: api.binaryMediaTypes ?? [],
    minimumCompressionSize: api.minimumCompressionSize ?? null,
    disableExecuteApiEndpoint: api.disableExecuteApiEndpoint ?? false,
    tags: api.tags ?? {},
    policy: restApiPolicyText(api.policy),
  };
}

/** One REST API, or `null` when the region has no API with that id. */
export async function getRestApi(scope: AwsScope, apiId: string): Promise<RestApiDetail | null> {
  const client = apiGatewayClient(scope);
  try {
    const api = await callAws("apigateway", () =>
      client.send(new GetRestApiCommand({ restApiId: apiId })),
    );
    return restApiDetail(api);
  } catch (err) {
    // A stale link or a pin from another region is an answer, not a fault.
    if (err instanceof AwsRequestError && err.code === "NotFoundException") return null;
    throw err;
  }
}
