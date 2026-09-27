import { describe, expect, it } from "vitest";

import { type MetricDescriptor, metricDimensionsText, metricMatches } from "./cloudwatch.ts";

const metric: MetricDescriptor = {
  namespace: "Snitch/Gateway",
  name: "LatencyMs",
  dimensions: [
    { name: "gateway", value: "snitch-ladder" },
    { name: "status", value: "400" },
  ],
};

describe("metricDimensionsText", () => {
  it("writes each dimension as name=value", () => {
    expect(metricDimensionsText(metric)).toBe("gateway=snitch-ladder, status=400");
    expect(metricDimensionsText({ ...metric, dimensions: [] })).toBe("-");
  });
});

describe("metricMatches", () => {
  it("matches bare text in any column, case ignored", () => {
    expect(metricMatches(metric, "snitch")).toBe(true);
    expect(metricMatches(metric, "LATENCY")).toBe(true);
    expect(metricMatches(metric, "status=400")).toBe(true);
    expect(metricMatches(metric, "cpu")).toBe(false);
  });

  it("looks in one column for column:value, as the table does", () => {
    expect(metricMatches(metric, "metric:latency")).toBe(true);
    expect(metricMatches(metric, "namespace:latency")).toBe(false);
    expect(metricMatches(metric, "dimensions:ladder")).toBe(true);
  });

  it("treats an unknown column as plain text", () => {
    expect(metricMatches(metric, "gateway=snitch")).toBe(true);
    expect(metricMatches(metric, "nope:x")).toBe(false);
    expect(metricMatches(metric, "constructor:x")).toBe(false);
  });

  it("matches everything with an empty filter", () => {
    expect(metricMatches(metric, "  ")).toBe(true);
  });
});
