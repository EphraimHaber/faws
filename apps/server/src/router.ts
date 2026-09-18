import { awsRouter } from "./api/aws/aws.router.ts";
import { desktopRouter } from "./api/desktop/desktop.router.ts";
import { ecsActionsRouter } from "./api/ecs/actions.router.ts";
import { ecsRouter } from "./api/ecs/ecs.router.ts";
import { execRouter } from "./api/exec/exec.router.ts";
import { s3ActionsRouter } from "./api/s3/actions.router.ts";
import { s3ConnectionsRouter } from "./api/s3/connections.router.ts";
import { s3Router } from "./api/s3/s3.router.ts";
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
  aws: awsRouter,
  desktop: desktopRouter,
  ecs: ecsRouter,
  ecsActions: ecsActionsRouter,
  exec: execRouter,
  s3: s3Router,
  s3Actions: s3ActionsRouter,
  s3Connections: s3ConnectionsRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
