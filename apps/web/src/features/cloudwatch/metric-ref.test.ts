import { describe, expect, it } from "vitest";

import { chartGeometry, gapSegments, nearestIndex, niceCeiling } from "~/components/metric-chart";

import { dimensionsLabel, formatterFor, metricKey, retentionLabel } from "./metric-ref.ts";

describe("metricKey", () => {
  it("ignores the order the dimensions were listed in", () => {
    const a = metricKey({
      namespace: "AWS/ECS",
      name: "CPUUtilization",
      dimensions: [
        { name: "ClusterName", value: "prod" },
        { name: "ServiceName", value: "api" },
      ],
    });
    const b = metricKey({
      namespace: "AWS/ECS",
      name: "CPUUtilization",
      dimensions: [
        { name: "ServiceName", value: "api" },
        { name: "ClusterName", value: "prod" },
      ],
    });
    expect(a).toBe(b);
  });

  it("tells one name under two dimension sets apart", () => {
    const base = { namespace: "AWS/ECS", name: "CPUUtilization" };
    expect(metricKey({ ...base, dimensions: [{ name: "ClusterName", value: "prod" }] })).not.toBe(
      metricKey({ ...base, dimensions: [] }),
    );
  });
});

describe("dimensionsLabel", () => {
  it("writes a metric without dimensions as a dash", () => {
    expect(dimensionsLabel({ namespace: "N", name: "M", dimensions: [] })).toBe("-");
  });
});

describe("formatterFor", () => {
  it("names the unit a bare number would hide", () => {
    expect(formatterFor("Milliseconds")(250)).toBe("250 ms");
    expect(formatterFor("Percent")(12.34)).toBe("12.3%");
    expect(formatterFor("Bytes")(2048)).toBe("2.0 KiB");
    expect(formatterFor("Count")(null)).toBe("-");
  });
});

describe("retentionLabel", () => {
  it("says what the console's retention choices mean", () => {
    expect(retentionLabel(null)).toBe("Never expire");
    expect(retentionLabel(1)).toBe("1 day");
    expect(retentionLabel(14)).toBe("14 days");
    expect(retentionLabel(30)).toBe("1 month");
    expect(retentionLabel(180)).toBe("6 months");
    expect(retentionLabel(365)).toBe("1 year");
    expect(retentionLabel(3653)).toBe("3653 days");
  });
});

describe("niceCeiling", () => {
  it("rounds up to the next 1, 2 or 5 of the value's magnitude", () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(0.3)).toBeCloseTo(0.5);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(120)).toBe(200);
    expect(niceCeiling(1000)).toBe(1000);
  });
});

function at(minute: number, average: number) {
  return {
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    average,
    maximum: average,
  };
}

describe("chartGeometry", () => {
  it("places points by their time, so a gap stays a gap", () => {
    const geometry = chartGeometry([at(0, 1), at(1, 1), at(10, 1)], {
      axis: "auto",
      peakFloor: 0,
    });
    expect(geometry?.xs).toEqual([0, 10, 100]);
  });

  it("draws a single datapoint rather than calling the window empty", () => {
    const geometry = chartGeometry([at(0, 5)], { axis: "auto", peakFloor: 0 });
    expect(geometry?.xs).toEqual([50]);
    expect(chartGeometry([], { axis: "auto", peakFloor: 0 })).toBeNull();
  });

  it("finds the datapoint nearest the cursor", () => {
    expect(nearestIndex([0, 10, 100], 40)).toBe(1);
    expect(nearestIndex([0, 10, 100], 60)).toBe(2);
  });
});

describe("gapSegments", () => {
  it("breaks the line where the metric stopped reporting", () => {
    expect(gapSegments([0, 60, 120, 3600, 3660])).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });

  it("keeps a steady series whole, and a single point as its own run", () => {
    expect(gapSegments([0, 60, 120, 180])).toEqual([[0, 3]]);
    expect(gapSegments([0])).toEqual([[0, 0]]);
  });
});
