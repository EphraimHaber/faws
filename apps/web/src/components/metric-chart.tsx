import type { MetricSeries } from "@faws/contracts";
import * as React from "react";

import { clockTime, percent } from "~/lib/format";
import { cn } from "~/lib/utils";

/**
 * CloudWatch average + maximum for one metric, drawn as an area with the
 * max as a hairline above it.
 *
 * e1s prints these as numbers. A shape is the reason to leave the terminal:
 * a sawtooth that never settles and a flat line at 90% read differently at a
 * glance and identically as a column of percentages.
 */
export function MetricChart({
  series,
  height = 132,
  className,
  label: labelProp,
  format = percent,
  /** Charts of unrelated things should not share one ceiling. */
  peakFloor = 10,
}: {
  series: MetricSeries;
  height?: number;
  className?: string;
  /** Defaults to a name for the ECS metrics this was first drawn for. */
  label?: string;
  /** How a value reads: a percentage, a byte count, a plain number. */
  format?: (value: number | null) => string;
  peakFloor?: number;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const points = series.points;

  const geometry = React.useMemo(() => {
    if (points.length < 2) return null;
    const values = points.flatMap((p) => [p.average ?? 0, p.maximum ?? 0]);
    const peak = Math.max(peakFloor, Math.ceil(Math.max(...values) / 10) * 10);
    const stepX = 100 / (points.length - 1);
    const toY = (value: number | null) => 100 - ((value ?? 0) / peak) * 100;
    const path = (pick: (index: number) => number | null) =>
      points.map((_, i) => `${i === 0 ? "M" : "L"} ${i * stepX} ${toY(pick(i))}`).join(" ");
    const avgPath = path((i) => points[i]?.average ?? null);
    return {
      peak,
      stepX,
      avgPath,
      maxPath: path((i) => points[i]?.maximum ?? null),
      areaPath: `${avgPath} L 100 100 L 0 100 Z`,
    };
  }, [points, peakFloor]);

  const label = labelProp ?? (series.metric === "CPUUtilization" ? "CPU" : "Memory");
  const active = hover === null ? points.at(-1) : points[hover];

  if (!geometry) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-border bg-background/40 text-[12px] text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        No {label.toLowerCase()} datapoints in this window
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[9.5px] tracking-[0.2em] text-muted-foreground uppercase">
          {label}
        </span>
        <span className="font-mono text-[12.5px] text-foreground tabular">
          {format(active?.average ?? null)}
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground tabular">
          max {format(active?.maximum ?? null)}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/70 tabular">
          {active ? clockTime(active.timestamp) : ""}
        </span>
      </div>

      <div
        className="relative rounded-md border border-border bg-background/40"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          setHover(
            Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))),
          );
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
          aria-label={`${label} utilization over time`}
        >
          {[25, 50, 75].map((line) => (
            <line
              key={line}
              x1="0"
              x2="100"
              y1={line}
              y2={line}
              stroke="currentColor"
              strokeWidth="0.25"
              className="text-border"
            />
          ))}
          <path d={geometry.areaPath} className="fill-primary/15" />
          <path
            d={geometry.maxPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.6"
            strokeDasharray="1.5 1.5"
            vectorEffect="non-scaling-stroke"
            className="text-muted-foreground/55"
          />
          <path
            d={geometry.avgPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
            className="text-primary"
          />
          {hover !== null ? (
            <line
              x1={hover * geometry.stepX}
              x2={hover * geometry.stepX}
              y1="0"
              y2="100"
              stroke="currentColor"
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
              className="text-foreground/40"
            />
          ) : null}
        </svg>
        <span className="absolute top-1 right-1.5 font-mono text-[9px] text-muted-foreground/70 tabular">
          {geometry.peak}%
        </span>
      </div>
    </div>
  );
}
