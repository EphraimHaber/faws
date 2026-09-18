/**
 * Fetchers, grouped by AWS service.
 *
 * Each group owns its own clients and view-model mapping, so adding S3 or
 * Lambda means adding a directory here and a router under
 * `apps/server/src/api/`, with nothing existing to rewire.
 */
export * from "./cloudwatch/logs.ts";
export * from "./cloudwatch/metrics.ts";
export * from "./ecs/clusters.ts";
export * from "./ecs/deployments.ts";
export * from "./ecs/containerInstances.ts";
export * from "./ecs/services.ts";
export * from "./ecs/taskDefinitions.ts";
export * from "./ecs/tasks.ts";
export * from "./elb/targets.ts";
export * from "./s3/bucketConfig.ts";
export * from "./s3/buckets.ts";
export * from "./s3/objects.ts";
export * from "./s3/openAs.ts";
export * from "./s3/scan.ts";
export * from "./s3/storageMetrics.ts";
export * from "./s3/versions.ts";
