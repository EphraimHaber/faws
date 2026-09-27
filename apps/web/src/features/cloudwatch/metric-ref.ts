import { type MetricDescriptor, metricDimensionsText } from "@faws/contracts";
import { byteSize } from "@faws/shared";

import { percent } from "~/lib/format";

/**
 * One metric's identity as a single string, for row keys and comparisons.
 *
 * A metric is its namespace, its name and every dimension together - the same
 * name under two dimension sets is two metrics, and CloudWatch does not care
 * which order the dimensions were listed in, so neither does this.
 */
export function metricKey(metric: MetricDescriptor): string {
  const dimensions = metric.dimensions
    .map((dimension) => `${dimension.name}=${dimension.value}`)
    .toSorted()
    .join("\u0000");
  return `${metric.namespace}\u0001${metric.name}\u0001${dimensions}`;
}

/** Dimensions as one line: `ClusterName=prod, ServiceName=api`. */
export const dimensionsLabel = metricDimensionsText;

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumSignificantDigits: 3,
});

/**
 * How a value reads, from the unit CloudWatch reported for it.
 *
 * Bytes and percentages get the formatters the rest of the app uses; anything
 * else is a compact number with its unit named, since a bare "1.2K" on a
 * latency chart says nothing about whether it is milliseconds or seconds.
 */
export function formatterFor(unit: string | null | undefined): (value: number | null) => string {
  switch (unit) {
    case "Percent":
      return percent;
    case "Bytes":
      return (value) => (value === null ? "-" : byteSize(value));
    case "Bytes/Second":
      return (value) => (value === null ? "-" : `${byteSize(value)}/s`);
    case "Seconds":
      return (value) => (value === null ? "-" : `${compact.format(value)} s`);
    case "Milliseconds":
      return (value) => (value === null ? "-" : `${compact.format(value)} ms`);
    case "Microseconds":
      return (value) => (value === null ? "-" : `${compact.format(value)} µs`);
    case "Count/Second":
      return (value) => (value === null ? "-" : `${compact.format(value)}/s`);
    case undefined:
    case null:
    case "None":
    case "Count":
      return (value) => (value === null ? "-" : compact.format(value));
    default:
      return (value) => (value === null ? "-" : `${compact.format(value)} ${unit}`);
  }
}

/** A log group's retention as a person would say it. */
export function retentionLabel(days: number | null): string {
  if (days === null) return "Never expire";
  if (days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
  if (days % 30 === 0 && days >= 30) return days === 30 ? "1 month" : `${days / 30} months`;
  return days === 1 ? "1 day" : `${days} days`;
}
