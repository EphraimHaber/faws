/**
 * Read-only API Gateway surface for REST APIs.
 *
 * Nothing here changes an API, and nothing reads an API key's value.
 */
import { listRestApis } from "@faws/core";

import { guard, publicProcedure, router, scopeInput } from "../../trpc/index.ts";

export const apiGatewayRouter = router({
  restApis: publicProcedure
    .input(scopeInput)
    .query(({ input }) => guard(() => listRestApis(input))),
});
