import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Database } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { useS3Scope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";

/**
 * The front door of the S3 section: one card per thing S3 can show, each
 * carrying the count that says whether it is worth opening.
 */
export function S3IndexPage() {
  const scope = useS3Scope();
  const buckets = useQuery(trpc.s3.buckets.queryOptions(scope));
  const count = buckets.data?.length ?? 0;

  if (buckets.isError) {
    return (
      <Panel className="flex-1">
        <ErrorState error={buckets.error} onRetry={() => void buckets.refetch()} />
      </Panel>
    );
  }

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>S3</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {/* Buckets are an account wide list, so naming a region here would
              claim a scope the numbers below do not have. */}
          all regions
        </span>
      </PanelHeader>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <SectionCard
          to="/s3/buckets"
          icon={Database}
          label="Buckets"
          description="Every bucket the account can see, and the region each one answers in."
          metric={buckets.isPending ? "…" : String(count)}
          metricLabel={count === 1 ? "bucket" : "buckets"}
        />
      </div>
    </Panel>
  );
}

function SectionCard({
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
