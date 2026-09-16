import { GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import type { AwsScope, MetricSeries } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { callAws, cloudWatchClient } from "../../clients.ts";

export interface ServiceMetricsOptions {
  readonly cluster: string;
  readonly service: string;
  /** Lookback window in minutes (default 3h). */
  readonly windowMinutes?: number;
  readonly periodSeconds?: number;
}

/**
 * CPU + memory utilization for one service, the two series e1s surfaces.
 * Returned sorted by timestamp so the chart can bind straight to it.
 */
export async function serviceMetrics(
  scope: AwsScope,
  options: ServiceMetricsOptions,
): Promise<MetricSeries[]> {
  const client = cloudWatchClient(scope);
  const windowMinutes = options.windowMinutes ?? 180;
  const period = options.periodSeconds ?? 300;
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - windowMinutes * 60_000);

  const metrics = ["CPUUtilization", "MemoryUtilization"] as const;

  return Promise.all(
    metrics.map(async (metric): Promise<MetricSeries> => {
      const page = await callAws("cloudwatch", () =>
        client.send(
          new GetMetricStatisticsCommand({
            Namespace: "AWS/ECS",
            MetricName: metric,
            Dimensions: [
              { Name: "ClusterName", Value: options.cluster },
              { Name: "ServiceName", Value: options.service },
            ],
            StartTime: startTime,
            EndTime: endTime,
            Period: period,
            Statistics: ["Average", "Maximum"],
          }),
        ),
      );
      const points = (page.Datapoints ?? [])
        .map((point) => ({
          timestamp: toIso(point.Timestamp) ?? "",
          average: point.Average ?? null,
          maximum: point.Maximum ?? null,
        }))
        .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
      return { metric, points };
    }),
  );
}
