import {
  apiGatewayRouter,
  awsRouter,
  cloudwatchRouter,
  ecsActionsRouter,
  ecsRouter,
} from "@faws/provider-aws/server";

import { appRouter as hostAppRouter } from "./api/app/app.router.ts";
import { desktopRouter } from "./api/desktop/desktop.router.ts";
import { execRouter } from "./api/exec/exec.router.ts";
import { kubeRouter } from "@faws/provider-kubernetes/server";
import { s3ConnectionsRouter } from "@faws/provider-s3compat/server";
import { providersRouter } from "./api/providers/providers.router.ts";
import { storageRouter } from "./api/storage/storage.router.ts";
import { trustRouter } from "./api/trust/trust.router.ts";
import { settingsRouter } from "./api/settings/settings.router.ts";
import { router } from "./trpc/index.ts";

/**
 * One namespace per AWS service, plus the cross-cutting `aws` (identity) and
 * `desktop` (shell) namespaces.
 *
 * A new service is a new key here and a new directory under `api/` — the
 * client picks it up through the same typed `AppRouter`.
 */
export const appRouter = router({
  apiGateway: apiGatewayRouter,
  app: hostAppRouter,
  aws: awsRouter,
  cloudwatch: cloudwatchRouter,
  desktop: desktopRouter,
  ecs: ecsRouter,
  ecsActions: ecsActionsRouter,
  exec: execRouter,
  kube: kubeRouter,
  providers: providersRouter,
  s3Connections: s3ConnectionsRouter,
  settings: settingsRouter,
  storage: storageRouter,
  trust: trustRouter,
});

export type AppRouter = typeof appRouter;
