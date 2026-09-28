/**
 * Read-only API Gateway surface for REST APIs.
 *
 * Nothing here changes an API, and nothing reads an API key's value.
 */
import { getRestApi, listResources, listRestApis } from "@faws/core";
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
});
