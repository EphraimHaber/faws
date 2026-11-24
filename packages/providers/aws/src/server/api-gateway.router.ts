/**
 * Read-only API Gateway surface for REST APIs.
 *
 * Nothing here changes an API, and no API key's value is asked for or passed on.
 */
import { REST_API_EXPORT_FORMATS } from "@faws/contracts";
import {
  exportApi,
  getApiGatewayAccount,
  getRestApi,
  listApiKeys,
  listAuthorizers,
  listBasePathMappings,
  listDeployments,
  listDomainNames,
  listResources,
  listRestApis,
  listStages,
  listUsagePlanKeys,
  listUsagePlans,
} from "@faws/core";
import { z } from "zod";

import { guard, router } from "@faws/kit/server";

import { awsProcedure, scopeInput } from "./procedures.ts";

const restApiInput = scopeInput.extend({ apiId: z.string().min(1).max(64) });

export const apiGatewayRouter = router({
  restApis: awsProcedure.input(scopeInput).query(({ input }) => guard(() => listRestApis(input))),

  restApi: awsProcedure
    .input(restApiInput)
    .query(({ input }) => guard(() => getRestApi(input, input.apiId))),

  resources: awsProcedure
    .input(restApiInput)
    .query(({ input }) => guard(() => listResources(input, input.apiId))),

  stages: awsProcedure
    .input(restApiInput)
    .query(({ input }) => guard(() => listStages(input, input.apiId))),

  deployments: awsProcedure
    .input(restApiInput)
    .query(({ input }) => guard(() => listDeployments(input, input.apiId))),

  authorizers: awsProcedure
    .input(restApiInput)
    .query(({ input }) => guard(() => listAuthorizers(input, input.apiId))),

  export: awsProcedure
    .input(
      restApiInput.extend({
        stageName: z.string().min(1).max(128),
        format: z.enum(REST_API_EXPORT_FORMATS),
      }),
    )
    .query(({ input }) =>
      guard(() => exportApi(input, input.apiId, input.stageName, input.format)),
    ),

  domainNames: awsProcedure
    .input(scopeInput)
    .query(({ input }) => guard(() => listDomainNames(input))),

  basePathMappings: awsProcedure
    .input(
      scopeInput.extend({
        domainName: z.string().min(1).max(253),
        domainNameId: z.string().min(1).max(64).nullable(),
      }),
    )
    .query(({ input }) =>
      guard(() => listBasePathMappings(input, input.domainName, input.domainNameId)),
    ),

  usagePlans: awsProcedure
    .input(scopeInput)
    .query(({ input }) => guard(() => listUsagePlans(input))),

  usagePlanKeys: awsProcedure
    .input(scopeInput.extend({ usagePlanId: z.string().min(1).max(64) }))
    .query(({ input }) => guard(() => listUsagePlanKeys(input, input.usagePlanId))),

  apiKeys: awsProcedure.input(scopeInput).query(({ input }) => guard(() => listApiKeys(input))),

  account: awsProcedure
    .input(scopeInput)
    .query(({ input }) => guard(() => getApiGatewayAccount(input))),
});
