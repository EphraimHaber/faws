import { awsRouter } from "./api/aws/aws.router.ts";
import { desktopRouter } from "./api/desktop/desktop.router.ts";
import { ecsActionsRouter } from "./api/ecs/actions.router.ts";
import { ecsRouter } from "./api/ecs/ecs.router.ts";
import { s3Router } from "./api/s3/s3.router.ts";
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
  s3: s3Router,
});

export type AppRouter = typeof appRouter;
