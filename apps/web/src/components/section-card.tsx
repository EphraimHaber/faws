import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * One card on a service's front door: what the section holds, and the count
 * that says whether it is worth opening.
 *
 * The number leads because it is the part that decides. "Buckets" tells you
 * nothing you did not already know from the sidebar; "27" tells you whether to
 * click.
 */
export function SectionCard({
  to,
  icon: Icon,
  label,
  description,
  metric,
  metricLabel,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  description: string;
  /** Already formatted, so a pending card can show a placeholder. */
  metric: string;
  metricLabel: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-3 rounded-md border border-border p-3.5 transition-colors hover:border-primary/45 hover:bg-accent/50"
    >
      <span className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.7} />
        <span className="text-[13px]">{label}</span>
        <ArrowRight
          aria-hidden
          className="ml-auto size-3.5 text-muted-foreground/40 transition-colors group-hover:text-foreground"
          strokeWidth={1.8}
        />
      </span>

      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-[22px] leading-none tabular">{metric}</span>
        <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          {metricLabel}
        </span>
      </span>

      <span className="text-[11.5px] leading-snug text-muted-foreground">{description}</span>
    </Link>
  );
}
