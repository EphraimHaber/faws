import type { MetricSeries } from "@faws/contracts";
import * as React from "react";

import { clockTime, fullTimestamp, percent } from "~/lib/format";
import { cn } from "~/lib/utils";

type Point = MetricSeries["points"][number];

/**
 * CloudWatch average + maximum for one metric, drawn as an area with the
 * max as a hairline above it.
 *
 * e1s prints these as numbers. A shape is the reason to leave the terminal:
 * a sawtooth that never settles and a flat line at 90% read differently at a
 * glance and identically as a column of percentages.
 *
 * Points sit at their own time rather than evenly by index, so a metric that
 * only reports when something happens shows its gaps as gaps. Hovering marks
 * the nearest datapoint on both lines and says what it was beside the cursor.
 */
export function MetricChart({
  series,
  height = 132,
  className,
  label: labelProp,
  format = percent,
  /** Charts of unrelated things should not share one ceiling. */
  peakFloor = 10,
  axis = "percent",
  empty,
}: {
  series: Pick<MetricSeries, "metric" | "points">;
  height?: number;
  className?: string;
  /** Defaults to a name for the ECS metrics this was first drawn for. */
  label?: string;
  /** How a value reads: a percentage, a byte count, a plain number. */
  format?: (value: number | null) => string;
  peakFloor?: number;
  /**
   * How the ceiling is picked. `percent` rounds up to the next ten, which is
   * right for a utilization that lives between 0 and 100; `auto` rounds up to
   * the next 1, 2 or 5 of the value's own magnitude, for a metric that could
   * be a thousandth or a billion.
   */
  axis?: "percent" | "auto";
  /** What an empty window says instead of the default line. */
  empty?: React.ReactNode;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const points = series.points;

  const geometry = React.useMemo(
    () => chartGeometry(points, { axis, peakFloor }),
    [points, peakFloor, axis],
  );

  const label = labelProp ?? (series.metric === "CPUUtilization" ? "CPU" : "Memory");
  const active = hover === null ? points.at(-1) : points[hover];

  if (!geometry) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-md border border-border bg-background/40 text-[12px] text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        {empty ?? `No ${label.toLowerCase()} datapoints in this window`}
      </div>
    );
  }

  const hoverX = hover === null ? null : (geometry.xs[hover] ?? null);
  const hovered = hover === null ? null : points[hover];

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
          {points.length} {points.length === 1 ? "point" : "points"}
          {active ? ` · ${clockTime(active.timestamp)}` : ""}
        </span>
      </div>

      <div
        className="relative rounded-md border border-border bg-background/40"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHover(nearestIndex(geometry.xs, ((event.clientX - rect.left) / rect.width) * 100));
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
          aria-label={`${label} over time`}
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
          {hoverX !== null ? (
            <line
              x1={hoverX}
              x2={hoverX}
              y1="0"
              y2="100"
              stroke="currentColor"
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
              className="text-foreground/40"
            />
          ) : null}
        </svg>

        {/* The markers are HTML rather than SVG: the SVG stretches to the box,
            and a circle drawn in it would stretch into an ellipse. A sparse
            series gets a dot on every datapoint, so a lone reading between
            gaps is visible rather than a line segment of zero length. */}
        {points.length <= SPARSE_POINTS
          ? points.map((point, index) => (
              <Dot
                key={point.timestamp}
                x={geometry.xs[index] ?? 0}
                y={geometry.toY(point.average)}
                className="size-1.5 bg-primary"
              />
            ))
          : null}
        {hovered && hoverX !== null ? (
          <>
            <Dot
              x={hoverX}
              y={geometry.toY(hovered.maximum)}
              className="size-2 border border-muted-foreground bg-card"
            />
            <Dot
              x={hoverX}
              y={geometry.toY(hovered.average)}
              className="size-2.5 border-2 border-card bg-primary"
            />
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2 py-1 font-mono text-[10.5px] whitespace-nowrap text-popover-foreground shadow-md tabular"
              style={{
                left: `${hoverX}%`,
                top: `${Math.min(70, Math.max(0, geometry.toY(hovered.average) - 12))}%`,
                // Past the middle the tip opens to the left, so it never runs
                // off the edge it is nearest.
                transform: hoverX > 55 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
              }}
            >
              <div className="text-muted-foreground">{fullTimestamp(hovered.timestamp)}</div>
              <div>
                avg <span className="text-foreground">{format(hovered.average)}</span>
              </div>
              <div>
                max <span className="text-foreground">{format(hovered.maximum)}</span>
              </div>
            </div>
          </>
        ) : null}

        <span className="absolute top-1 right-1.5 font-mono text-[9px] text-muted-foreground/70 tabular">
          {axis === "percent" ? `${geometry.peak}%` : format(geometry.peak)}
        </span>
      </div>
    </div>
  );
}

/** At or under this many points, every datapoint gets a dot of its own. */
const SPARSE_POINTS = 40;

function Dot({ x, y, className }: { x: number; y: number; className: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
        className,
      )}
      style={{ left: `${x}%`, top: `${y}%` }}
    />
  );
}

export interface ChartGeometry {
  readonly peak: number;
  /** Each point's x, 0 to 100, by its time. */
  readonly xs: ReadonlyArray<number>;
  readonly toY: (value: number | null) => number;
  readonly avgPath: string;
  readonly maxPath: string;
  readonly areaPath: string;
}

/**
 * Where each point sits, and the paths through them.
 *
 * x is proportional to time between the first and last point. A single point,
 * which has no span to be proportional to, sits in the middle.
 */
export function chartGeometry(
  points: ReadonlyArray<Point>,
  { axis, peakFloor }: { axis: "percent" | "auto"; peakFloor: number },
): ChartGeometry | null {
  if (points.length === 0) return null;
  const values = points.flatMap((p) => [p.average ?? 0, p.maximum ?? 0]);
  const top = Math.max(...values);
  const peak =
    axis === "percent"
      ? Math.max(peakFloor, Math.ceil(top / 10) * 10)
      : niceCeiling(Math.max(peakFloor, top));

  const times = points.map((p) => Date.parse(p.timestamp));
  const first = times[0] ?? 0;
  const span = (times.at(-1) ?? first) - first;
  const xs = times.map((time) => (span > 0 ? ((time - first) / span) * 100 : 50));

  const toY = (value: number | null) => 100 - ((value ?? 0) / peak) * 100;
  const segments = gapSegments(times);
  const path = (pick: (point: Point) => number | null, [start, end]: Segment) =>
    points
      .slice(start, end + 1)
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xs[start + i] ?? 0} ${toY(pick(p))}`)
      .join(" ");
  return {
    peak,
    xs,
    toY,
    avgPath: segments.map((segment) => path((p) => p.average, segment)).join(" "),
    maxPath: segments.map((segment) => path((p) => p.maximum, segment)).join(" "),
    areaPath: segments
      .map(
        (segment) =>
          `${path((p) => p.average, segment)} L ${xs[segment[1]] ?? 0} 100 L ${xs[segment[0]] ?? 0} 100 Z`,
      )
      .join(" "),
  };
}

/** First and last index of a run of points with no gap between them. */
type Segment = readonly [number, number];

/**
 * Splits the points wherever the metric stopped reporting.
 *
 * CloudWatch returns nothing for a period with no data, so a line drawn
 * straight through would claim readings for days that had none. A gap is a
 * step more than three times the series' usual one - its shortest - which
 * allows for the odd late datapoint without breaking a steady line.
 */
export function gapSegments(times: ReadonlyArray<number>): Segment[] {
  if (times.length === 0) return [];
  const steps = times.slice(1).map((time, i) => time - (times[i] ?? time));
  const usual = Math.min(...steps.filter((step) => step > 0));
  const segments: Segment[] = [];
  let start = 0;
  steps.forEach((step, i) => {
    if (Number.isFinite(usual) && step > usual * 3) {
      segments.push([start, i]);
      start = i + 1;
    }
  });
  segments.push([start, times.length - 1]);
  return segments;
}

/** The index whose x is closest to `x`. */
export function nearestIndex(xs: ReadonlyArray<number>, x: number): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  xs.forEach((candidate, index) => {
    const next = Math.abs(candidate - x);
    if (next < distance) {
      best = index;
      distance = next;
    }
  });
  return best;
}

/** The smallest 1, 2 or 5 times a power of ten that is at least `value`. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}
