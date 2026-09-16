import type { AppRouter } from "@faws/server/router";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";

import { resolveTrpcUrl } from "./apiUrl.ts";
import { queryClient } from "./query-client.ts";

export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: resolveTrpcUrl(), transformer: superjson, methodOverride: "POST" })],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });
