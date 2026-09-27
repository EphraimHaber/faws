import { GetMetricStatisticsCommand, ListMetricsCommand } from "@aws-sdk/client-cloudwatch";
import type {
  AwsScope,
  CloudWatchWindow,
  MetricDescriptor,
  MetricDimension,
  MetricChartData,
  MetricPage,
  MetricSeries,
} from "@faws/contracts";
import { metricMatches, periodFor } from "@faws/contracts";
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

/**
 * A filtered page stops walking once it has this many matches, so the first
 * rows arrive quickly and the rest load as the table scrolls.
 */
const MIN_PAGE_MATCHES = 100;

/**
 * And stops after this many ListMetrics pages (5,000 metrics) whatever it has
 * found, so a filter that matches almost nothing answers in seconds with a
 * token to go on, rather than walking the whole account in one request.
 */
const MAX_PAGES_PER_CALL = 10;

/**
 * One page of the metrics that have reported in the last two weeks,
 * optionally in one namespace and narrowed by a table filter.
 *
 * Unfiltered, a page is one ListMetrics page. Filtered, it walks ListMetrics
 * pages, keeping matches, until it has enough of them or has walked its share,
 * and hands back the token to carry on from - so every metric in the account
 * is reachable by scrolling, with nothing capped and nothing held in memory
 * that the table has not asked for.
 */
export async function listMetricsPage(
  scope: AwsScope,
  options: {
    readonly namespace?: string;
    readonly query?: string;
    readonly cursor?: string;
  } = {},
): Promise<MetricPage> {
  const client = cloudWatchClient(scope);
  const query = options.query?.trim() ?? "";
  const items: MetricDescriptor[] = [];
  let token = options.cursor;
  let pages = 0;
  let scanned = 0;
  do {
    const page = await callAws("cloudwatch", () =>
      client.send(
        new ListMetricsCommand({
          ...(options.namespace ? { Namespace: options.namespace } : {}),
          ...(token ? { NextToken: token } : {}),
        }),
      ),
    );
    token = page.NextToken;
    pages += 1;
    for (const metric of page.Metrics ?? []) {
      if (!metric.Namespace || !metric.MetricName) continue;
      scanned += 1;
      const descriptor: MetricDescriptor = {
        namespace: metric.Namespace,
        name: metric.MetricName,
        dimensions: (metric.Dimensions ?? []).map((dimension) => ({
          name: dimension.Name ?? "",
          value: dimension.Value ?? "",
        })),
      };
      if (metricMatches(descriptor, query)) items.push(descriptor);
    }
    // Unfiltered, one ListMetrics page is one page of the table.
    if (!query) break;
  } while (token && items.length < MIN_PAGE_MATCHES && pages < MAX_PAGES_PER_CALL);

  return { items, nextToken: token ?? null, scanned };
}

export interface MetricSeriesQuery {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensions: ReadonlyArray<MetricDimension>;
  readonly windowMinutes: CloudWatchWindow;
}

/**
 * Average and maximum of any one metric over a window ending now, the same
 * pair the ECS charts draw.
 *
 * A metric can be listed and still be empty in the window: ListMetrics names
 * anything that reported in the last two weeks, and plenty of metrics report
 * only when something happens. For those, a second, coarse read over the two
 * weeks finds when it last reported, so the page can offer the window that
 * would show it rather than a blank chart.
 */
export async function metricSeries(
  scope: AwsScope,
  query: MetricSeriesQuery,
): Promise<MetricChartData> {
  const client = cloudWatchClient(scope);
  const dimensions = query.dimensions.map((dimension) => ({
    Name: dimension.name,
    Value: dimension.value,
  }));
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - query.windowMinutes * 60_000);
  const page = await callAws("cloudwatch", () =>
    client.send(
      new GetMetricStatisticsCommand({
        Namespace: query.namespace,
        MetricName: query.metricName,
        Dimensions: dimensions,
        StartTime: startTime,
        EndTime: endTime,
        Period: periodFor(query.windowMinutes),
        Statistics: ["Average", "Maximum"],
      }),
    ),
  );
  const datapoints = page.Datapoints ?? [];
  const points = datapoints
    .map((point) => ({
      timestamp: toIso(point.Timestamp) ?? "",
      average: point.Average ?? null,
      maximum: point.Maximum ?? null,
    }))
    .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));

  let lastDatapointAt: string | null = null;
  if (points.length === 0) {
    const lookback = await callAws("cloudwatch", () =>
      client.send(
        new GetMetricStatisticsCommand({
          Namespace: query.namespace,
          MetricName: query.metricName,
          Dimensions: dimensions,
          StartTime: new Date(endTime.getTime() - LOOKBACK_DAYS * 86_400_000),
          EndTime: endTime,
          // An hour a point is 360 points over fifteen days, under the cap.
          Period: 3600,
          Statistics: ["SampleCount"],
        }),
      ),
    );
    lastDatapointAt =
      (lookback.Datapoints ?? [])
        .map((point) => toIso(point.Timestamp) ?? "")
        .toSorted()
        .at(-1) || null;
  }

  return {
    metric: query.metricName,
    unit: datapoints[0]?.Unit ?? null,
    points,
    lastDatapointAt,
  };
}

/** How far back an empty window looks for the metric's last datapoint. */
const LOOKBACK_DAYS = 15;
