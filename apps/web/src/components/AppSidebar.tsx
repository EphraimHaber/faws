import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Home, ScrollText, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { StatusDot } from "~/components/ui/status-dot";
import { AWS_SERVICES, type AwsServiceDefinition } from "~/services/registry";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

/**
 * Navigation plus the live cluster list.
 *
 * A TUI can only show one level at a time; the sidebar keeps every cluster and
 * its task counts on screen while you work inside one of them, so switching
 * context costs a click instead of two Escapes and a re-list.
 */
export function AppSidebar() {
  const scope = useAwsScope();
  const { location } = useRouterState();
  const [filter, setFilter] = React.useState("");

  const clusters = useQuery(trpc.ecs.clusters.queryOptions(scope));

  const visible = React.useMemo(() => {
    const query = filter.trim().toLowerCase();
    const rows = clusters.data ?? [];
    return query ? rows.filter((c) => c.name.toLowerCase().includes(query)) : rows;
  }, [clusters.data, filter]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-chrome">
      <nav className="flex flex-col gap-px px-2.5 pt-3 pb-2">
        <NavLink to="/" icon={Home} label="Overview" active={location.pathname === "/"} />

        <span aria-hidden className="mx-2 my-1.5 h-px bg-border" />

        {AWS_SERVICES.map((service) =>
          service.status === "available" ? (
            <React.Fragment key={service.id}>
              {/* The service root is its own destination - a card page naming
                  what the section holds - so it gets a row above the sections
                  rather than standing in for the first of them. */}
              <NavLink
                to={service.basePath}
                icon={service.icon}
                label={service.label}
                active={location.pathname === service.basePath}
              />
              {service.sections.map((section) => (
                <NavLink
                  key={`${service.id}:${section.id}`}
                  to={section.to ?? service.basePath}
                  icon={section.icon}
                  label={section.label}
                  indent
                  active={location.pathname.startsWith(section.to ?? service.basePath)}
                />
              ))}
            </React.Fragment>
          ) : (
            <PlannedLink key={service.id} service={service} />
          ),
        )}

        <span aria-hidden className="mx-2 my-1.5 h-px bg-border" />

        <NavLink
          to="/logs"
          icon={ScrollText}
          label="Diagnostics"
          active={location.pathname.startsWith("/logs")}
        />
        <NavLink
          to="/settings"
          icon={Settings2}
          label="Settings"
          active={location.pathname.startsWith("/settings")}
        />
      </nav>

      <div className="mx-3.5 mt-2 mb-1.5 flex items-center gap-2.5 border-t border-border pt-3.5">
        <span className="font-mono text-[9.5px] tracking-[0.26em] text-muted-foreground uppercase">
          Clusters
        </span>
        <span aria-hidden className="h-px flex-1 bg-border" />
        <span className="font-mono text-[10px] text-muted-foreground/70 tabular">
          {clusters.data ? visible.length : "—"}
        </span>
      </div>

      <div className="px-2.5 pb-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter clusters…"
          className="h-7 w-full rounded-md border border-border bg-background/50 px-2.5 text-[12px] placeholder:text-muted-foreground/55 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3">
        {clusters.isPending ? (
          <div className="flex flex-col gap-1 px-0.5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : null}

        {clusters.isError ? (
          <p className="px-2 py-3 text-[11.5px] leading-relaxed text-danger">
            {clusters.error instanceof Error ? clusters.error.message : "Failed to list clusters"}
          </p>
        ) : null}

        {visible.map((cluster) => {
          const active = location.pathname.startsWith(
            `/ecs/clusters/${encodeURIComponent(cluster.name)}`,
          );
          const busy = cluster.pendingTasks > 0;
          return (
            <Link
              key={cluster.arn}
              to="/ecs/clusters/$cluster"
              params={{ cluster: cluster.name }}
              className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
                active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              <StatusDot
                tone={cluster.status === "ACTIVE" ? (busy ? "warning" : "success") : "neutral"}
                pulse={busy}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                {cluster.name}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground tabular">
                {cluster.activeServices}·{cluster.runningTasks}
              </span>
            </Link>
          );
        })}

        {clusters.isSuccess && visible.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11.5px] text-muted-foreground">
            {filter ? "No matches." : "No clusters in this region."}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

/**
 * Services faws doesn't cover yet are listed, not hidden: the gap between
 * "this tool can't do that" and "I can't find it" is worth a disabled row.
 */
function PlannedLink({ service }: { service: AwsServiceDefinition }) {
  const Icon = service.icon;
  return (
    <span
      title={`${service.description} — not implemented yet`}
      className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] text-muted-foreground/45"
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
      {service.label}
      <span className="ml-auto font-mono text-[9px] tracking-[0.18em] uppercase">soon</span>
    </span>
  );
}

function NavLink({
  to,
  icon: Icon,
  label,
  active,
  indent = false,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  /** Sections sit under the service they belong to. */
  indent?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] transition-colors",
        indent && "ml-3",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
      {label}
    </Link>
  );
}
