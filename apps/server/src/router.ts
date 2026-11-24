import { apiGatewayRouter } from "./api/api-gateway/api-gateway.router.ts";
import { awsRouter } from "./api/aws/aws.router.ts";
import { cloudwatchRouter } from "./api/cloudwatch/cloudwatch.router.ts";
import { desktopRouter } from "./api/desktop/desktop.router.ts";
import { ecsActionsRouter } from "./api/ecs/actions.router.ts";
import { ecsRouter } from "./api/ecs/ecs.router.ts";
import { execRouter } from "./api/exec/exec.router.ts";
import { kubeRouter } from "@faws/provider-kubernetes/server";
import { providersRouter } from "./api/providers/providers.router.ts";
import { s3ActionsRouter } from "./api/s3/actions.router.ts";
import { s3ConnectionsRouter } from "./api/s3/connections.router.ts";
import { s3Router } from "./api/s3/s3.router.ts";
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
  aws: awsRouter,
  cloudwatch: cloudwatchRouter,
  desktop: desktopRouter,
  ecs: ecsRouter,
  ecsActions: ecsActionsRouter,
  exec: execRouter,
  kube: kubeRouter,
  providers: providersRouter,
  s3: s3Router,
  s3Actions: s3ActionsRouter,
  s3Connections: s3ConnectionsRouter,
  settings: settingsRouter,
  trust: trustRouter,
});

export type AppRouter = typeof appRouter;
