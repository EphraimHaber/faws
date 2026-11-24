/**
 * AWS on the server: one router per service, each gated on AWS being on.
 * The engines they call - SDK clients, fetchers, actions - are in `@faws/core`.
 */
export { apiGatewayRouter } from "./api-gateway.router.ts";
export { awsRouter } from "./aws.router.ts";
export { cloudwatchRouter } from "./cloudwatch.router.ts";
export { ecsActionsRouter } from "./ecs-actions.router.ts";
export { ecsRouter } from "./ecs.router.ts";
export { awsProcedure, scopeInput } from "./procedures.ts";
