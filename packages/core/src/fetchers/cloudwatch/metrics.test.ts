import { describe, expect, it } from "vitest";

import { chartPoints } from "./metrics.ts";

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

describe("chartPoints", () => {
  it("draws the average under the maximum by default, oldest first", () => {
    expect(
      chartPoints("average", [
        { Timestamp: at(1), Average: 4, Maximum: 9 },
        { Timestamp: at(0), Average: 2, Maximum: 3 },
      ]),
    ).toEqual([
      { timestamp: "2026-01-01T00:00:00.000Z", average: 2, maximum: 3 },
      { timestamp: "2026-01-01T00:01:00.000Z", average: 4, maximum: 9 },
    ]);
  });

  it("puts a sum on the line with no hairline", () => {
    expect(chartPoints("sum", [{ Timestamp: at(0), Sum: 120, Maximum: 1 }])).toEqual([
      { timestamp: "2026-01-01T00:00:00.000Z", average: 120, maximum: null },
    ]);
  });

  it("joins the p99 to the average of the same timestamp", () => {
    expect(
      chartPoints(
        "p99",
        [
          { Timestamp: at(0), Average: 40 },
          { Timestamp: at(1), Average: 50 },
        ],
        [{ Timestamp: at(1), ExtendedStatistics: { p99: 900 } }],
      ),
    ).toEqual([
      { timestamp: "2026-01-01T00:00:00.000Z", average: 40, maximum: null },
      { timestamp: "2026-01-01T00:01:00.000Z", average: 50, maximum: 900 },
    ]);
  });

  it("keeps an empty statistic as null rather than zero", () => {
    expect(chartPoints("average", [{ Timestamp: at(0) }])).toEqual([
      { timestamp: "2026-01-01T00:00:00.000Z", average: null, maximum: null },
    ]);
  });
});
