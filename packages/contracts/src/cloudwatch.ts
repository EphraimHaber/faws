import type { LogEvent } from "./ecs.ts";

/** One log group, as DescribeLogGroups reports it. */
export interface LogGroup {
  readonly name: string;
  readonly arn: string | null;
  readonly createdAt: string | null;
  /** `null` means the group never expires anything. */
  readonly retentionDays: number | null;
  readonly storedBytes: number | null;
  /** STANDARD, INFREQUENT_ACCESS or DELIVERY. */
  readonly logClass: string | null;
}

/** The log groups a listing reached; `truncated` when the region has more. */
export interface LogGroupListing {
  readonly groups: ReadonlyArray<LogGroup>;
  readonly truncated: boolean;
}

/** One stream in a log group, newest activity first. */
export interface LogStream {
  readonly name: string;
  readonly createdAt: string | null;
  readonly firstEventAt: string | null;
  readonly lastEventAt: string | null;
}

/**
 * A window of events from a log group, oldest first.
 *
 * `truncated` says which part of the window is missing when it held more than
 * one read covers: `older` when these are its newest lines and earlier ones
 * were left out, `newer` when the read stopped short of now and these are the
 * window's oldest.
 */
export interface LogEventWindow {
  readonly events: ReadonlyArray<LogEvent>;
  readonly truncated: "older" | "newer" | null;
}

export interface MetricDimension {
  readonly name: string;
  readonly value: string;
}

/** A metric that exists, as ListMetrics names it. No datapoints yet. */
export interface MetricDescriptor {
  readonly namespace: string;
  readonly name: string;
  readonly dimensions: ReadonlyArray<MetricDimension>;
}

/** Dimensions as one line: `ClusterName=prod, ServiceName=api`, or `-` for none. */
export function metricDimensionsText(metric: MetricDescriptor): string {
  if (metric.dimensions.length === 0) return "-";
  return metric.dimensions.map((dimension) => `${dimension.name}=${dimension.value}`).join(", ");
}

/**
 * Whether a metric answers a table filter, in the table's own grammar:
 * `column:value` looks in one column (namespace, metric or dimensions), bare
 * text in any, case ignored either way.
 *
 * Here rather than in the table because the server runs it too, when a search
 * walks more metrics than the page can hold - and a server that matched
 * differently from the box would hand back rows the box then hides.
 */
export function metricMatches(metric: MetricDescriptor, filter: string): boolean {
  const query = filter.trim().toLowerCase();
  if (query.length === 0) return true;
  const fields: Record<string, string> = {
    namespace: metric.namespace,
    metric: metric.name,
    dimensions: metricDimensionsText(metric),
  };
  const colon = query.indexOf(":");
  if (colon > 0) {
    const column = query.slice(0, colon);
    // Own keys only: `constructor:x` is text to look for, not a column.
    const field = Object.hasOwn(fields, column) ? fields[column] : undefined;
    if (field !== undefined) return field.toLowerCase().includes(query.slice(colon + 1));
  }
  return Object.values(fields).some((field) => field.toLowerCase().includes(query));
}

/**
 * One page of metrics, from ListMetrics, optionally narrowed by a filter.
 *
 * ListMetrics can only narrow by exact names, so a filter is matched on the
 * server as it pages - which means a page of matches may have walked several
 * pages of metrics, and one that matched nothing can still have more to come.
 * `scanned` is how many metrics this page walked, `nextToken` where to resume.
 */
export interface MetricPage {
  readonly items: ReadonlyArray<MetricDescriptor>;
  readonly nextToken: string | null;
  readonly scanned: number;
}

/**
 * A metric's datapoints over a window, and - when the window held none - when
 * it last reported at all, so an empty chart can say how far back to look
 * instead of only that there is nothing here.
 */
export interface MetricChartData {
  readonly metric: string;
  readonly unit: string | null;
  readonly points: ReadonlyArray<{
    readonly timestamp: string;
    readonly average: number | null;
    readonly maximum: number | null;
  }>;
  /** Only looked up when `points` is empty; null when it has not reported in two weeks. */
  readonly lastDatapointAt: string | null;
}

/**
 * How far back a CloudWatch page reads, in minutes.
 *
 * A fixed set rather than any number, so each one can be given a period that
 * keeps a chart under GetMetricStatistics' datapoint cap.
 */
export const CLOUDWATCH_WINDOWS = [15, 60, 180, 720, 1440, 10_080] as const;
export type CloudWatchWindow = (typeof CLOUDWATCH_WINDOWS)[number];

export const DEFAULT_CLOUDWATCH_WINDOW: CloudWatchWindow = 60;

/**
 * How many log groups are tailed side by side. Each is its own query on every
 * poll, so the cap is what keeps a tail from becoming a request storm.
 */
export const MAX_TAILED_GROUPS = 10;

/** Short label for a window: 15m, 1h, 3h, 12h, 1d, 7d. */
export function windowLabel(minutes: CloudWatchWindow): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${minutes / 60}h`;
  return `${minutes / 1440}d`;
}

/**
 * The period a window is charted at: one minute up to three hours, then
 * coarser, so no window asks for more than 720 datapoints.
 */
export function periodFor(minutes: CloudWatchWindow): number {
  if (minutes <= 180) return 60;
  if (minutes <= 1440) return 300;
  return 3600;
}
