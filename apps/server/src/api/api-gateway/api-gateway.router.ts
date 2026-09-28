/**
 * Read-only API Gateway surface for REST APIs.
 *
 * Nothing here changes an API, and nothing reads an API key's value.
 */
import { REST_API_EXPORT_FORMATS } from "@faws/contracts";
import {
  exportApi,
  getRestApi,
  listAuthorizers,
  listBasePathMappings,
  listDeployments,
  listDomainNames,
  listResources,
  listRestApis,
  listStages,
} from "@faws/core";
import { z } from "zod";

import { guard, publicProcedure, router, scopeInput } from "../../trpc/index.ts";

const restApiInput = scopeInput.extend({ apiId: z.string().min(1).max(64) });

export const apiGatewayRouter = router({
  restApis: publicProcedure
    .input(scopeInput)
    .query(({ input }) => guard(() => listRestApis(input))),

  restApi: publicProcedure
    .input(restApiInput)
    .query(({ input }) => guard(() => getRestApi(input, input.apiId))),

  resources: publicProcedure
    .input(restApiInput)
    .query(({ input }) => guard(() => listResources(input, input.apiId))),

  stages: publicProcedure
    .input(restApiInput)
    .query(({ input }) => guard(() => listStages(input, input.apiId))),

  deployments: publicProcedure
    .input(restApiInput)
    .query(({ input }) => guard(() => listDeployments(input, input.apiId))),

  authorizers: publicProcedure
    .input(restApiInput)
    .query(({ input }) => guard(() => listAuthorizers(input, input.apiId))),

  export: publicProcedure
    .input(
      restApiInput.extend({
        stageName: z.string().min(1).max(128),
        format: z.enum(REST_API_EXPORT_FORMATS),
      }),
    )
    .query(({ input }) =>
      guard(() => exportApi(input, input.apiId, input.stageName, input.format)),
    ),

  domainNames: publicProcedure
    .input(scopeInput)
    .query(({ input }) => guard(() => listDomainNames(input))),

  basePathMappings: publicProcedure
    .input(
      scopeInput.extend({
        domainName: z.string().min(1).max(253),
        domainNameId: z.string().min(1).max(64).nullable(),
      }),
    )
    .query(({ input }) =>
      guard(() => listBasePathMappings(input, input.domainName, input.domainNameId)),
    ),
});
