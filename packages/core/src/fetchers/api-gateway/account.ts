import { type Account, GetAccountCommand } from "@aws-sdk/client-api-gateway";
import type { ApiGatewayAccount, AwsScope } from "@faws/contracts";

import { apiGatewayClient, callAws } from "../../clients.ts";

/** The account settings, with an empty role ARN read as no role. */
export function apiGatewayAccount(account: Account): ApiGatewayAccount {
  return { cloudwatchRoleArn: account.cloudwatchRoleArn || null };
}

/** API Gateway's account settings in the scoped region. */
export async function getApiGatewayAccount(scope: AwsScope): Promise<ApiGatewayAccount> {
  const client = apiGatewayClient(scope);
  const account = await callAws("apigateway", () => client.send(new GetAccountCommand({})));
  return apiGatewayAccount(account);
}
