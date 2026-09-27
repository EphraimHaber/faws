/**
 * What CloudWatch things are remembered as, in the pinned and recent lists.
 *
 * One builder per kind, so a list row and the page showing the same thing pin
 * the same `resourceKey` and toggle together.
 */
import { type MetricDescriptor, metricDimensionsText, type ResourceRef } from "@faws/contracts";

interface AwsScope {
  readonly profile: string;
  readonly region: string;
}

/**
 * The id is the group's name rather than its ARN: the row and the route both
 * have the name before anything loads.
 */
export function logGroupRef(group: string, scope: AwsScope): ResourceRef {
  return {
    kind: "cloudwatch-log-group",
    id: group,
    label: group,
    detail: "log group",
    scope: { profile: scope.profile, region: scope.region, connectionId: "" },
    to: `/cloudwatch/log-groups/${encodeURIComponent(group)}`,
  };
}

/**
 * A metric is its namespace, name and every dimension, so all three are in the
 * id - sorted, so the order ListMetrics happened to list the dimensions in
 * does not make one metric two pins. It opens as the chart on the metrics
 * page, in its namespace.
 */
export function metricRef(metric: MetricDescriptor, scope: AwsScope): ResourceRef {
  const dimensions = metric.dimensions
    .map((dimension) => `${dimension.name}=${dimension.value}`)
    .toSorted()
    .join(",");
  const chart = encodeURIComponent(
    JSON.stringify({
      namespace: metric.namespace,
      name: metric.name,
      dimensions: metric.dimensions,
    }),
  );
  return {
    kind: "cloudwatch-metric",
    id: `${metric.namespace}/${metric.name}{${dimensions}}`,
    label: metric.name.slice(0, 200),
    detail: `${metric.namespace} · ${metricDimensionsText(metric)}`.slice(0, 400),
    scope: { profile: scope.profile, region: scope.region, connectionId: "" },
    to: `/cloudwatch/metrics?ns=${encodeURIComponent(metric.namespace)}&chart=${chart}`,
  };
}
