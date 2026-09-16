import { cn } from "~/lib/utils";

/**
 * running / desired as a bar, not two numbers.
 *
 * This is the clearest single thing a GUI adds to `2/3`: the gap is visible
 * at a glance across a list of forty services, which is exactly the scan a
 * terminal table makes you do row by row.
 */
export function CountMeter({
  running,
  desired,
  pending = 0,
  className,
}: {
  running: number;
  desired: number;
  pending?: number;
  className?: string;
}) {
  const target = Math.max(desired, running + pending, 1);
  // Clamped rather than clipped: a bar that is mathematically incapable of
  // exceeding its track needs no overflow rule to hide the excess.
  const runningPct = Math.min(100, (running / target) * 100);
  const pendingPct = Math.min(100 - runningPct, (pending / target) * 100);
  const short = desired > 0 && running < desired;

  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="font-mono text-[11.5px] tabular">
        <span className={short ? "text-warning" : "text-foreground"}>{running}</span>
        <span className="text-muted-foreground/60">/{desired}</span>
      </span>
      <span className="relative h-1 w-14 rounded-full bg-muted">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            short ? "bg-warning" : "bg-success",
          )}
          style={{ width: `${runningPct}%` }}
        />
        {pending > 0 ? (
          <span
            className="absolute inset-y-0 rounded-full bg-info/70"
            style={{ left: `${runningPct}%`, width: `${pendingPct}%` }}
          />
        ) : null}
      </span>
    </span>
  );
}
