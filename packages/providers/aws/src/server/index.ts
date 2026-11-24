/**
 * AWS on the server: one router per service, each gated on AWS being on.
 * The engines they call - SDK clients, fetchers, actions - are in `@faws/core`;
 * S3 is its object storage port, built on `@faws/lib-s3`.
 */
export { apiGatewayRouter } from "./api-gateway.router.ts";
export { awsRouter } from "./aws.router.ts";
export { cloudwatchRouter } from "./cloudwatch.router.ts";
export { ecsActionsRouter } from "./ecs-actions.router.ts";
export { ecsRouter } from "./ecs.router.ts";
export { awsObjectStorage, registerAwsObjectStorage } from "./objectStorage.ts";
export { awsProcedure, scopeInput } from "./procedures.ts";
