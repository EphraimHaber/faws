/**
 * The CloudWatch metrics API Gateway publishes for a REST API, and the
 * dimensions that pick out one API, or one of its stages.
 */
import type { MetricDimension, MetricStatistic } from "@faws/contracts";

export const API_GATEWAY_NAMESPACE = "AWS/ApiGateway";

export interface RestApiMetric {
  readonly metric: string;
  readonly label: string;
  readonly statistic: MetricStatistic;
  /** Why the chart may be empty even while the API is busy. */
  readonly hint?: string;
}

/**
 * Counts are summed per period, so the line is how many there were rather
 * than the average of a 0 or 1 per request. Latencies are averaged under their
 * p99, where the slowest callers show.
 */
export const REST_API_METRICS: ReadonlyArray<RestApiMetric> = [
  { metric: "Count", label: "Requests", statistic: "sum" },
  { metric: "4XXError", label: "4xx errors", statistic: "sum" },
  { metric: "5XXError", label: "5xx errors", statistic: "sum" },
  { metric: "Latency", label: "Latency", statistic: "p99" },
  { metric: "IntegrationLatency", label: "Integration latency", statistic: "p99" },
  {
    metric: "CacheHitCount",
    label: "Cache hits",
    statistic: "sum",
    hint: "Only a stage with a cache reports it.",
  },
  {
    metric: "CacheMissCount",
    label: "Cache misses",
    statistic: "sum",
    hint: "Only a stage with a cache reports it.",
  },
];

/**
 * CloudWatch keys REST API metrics by the API's name, not its id. The name
 * alone is every stage together; with a stage, it is that stage alone.
 */
export function restApiDimensions(apiName: string, stageName: string | null): MetricDimension[] {
  const dimensions: MetricDimension[] = [{ name: "ApiName", value: apiName }];
  if (stageName) dimensions.push({ name: "Stage", value: stageName });
  return dimensions;
}

/** A period in seconds, as its shortest label: 1m, 5m, 1h. */
export function periodLabel(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
