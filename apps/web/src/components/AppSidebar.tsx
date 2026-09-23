import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Home, ScrollText, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { kindIcon } from "~/components/CommandPalette.entries";
import { EntityRow } from "~/components/entity-row";
import { PinButton } from "~/components/PinButton";
import { ResizeHandle } from "~/components/ui/resize-handle";
import { SectionHeader } from "~/components/ui/section-header";
import { StatusDot } from "~/components/ui/status-dot";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from "@faws/contracts";
import { AWS_SERVICES, type AwsServiceDefinition, visibleSections } from "~/services/registry";
import { useAwsScope } from "~/contexts/ScopeContext";
import { clusterRef } from "~/features/ecs/refs";
import { useKubeDiagnostics } from "~/features/kube/useKubeDiagnostics";
import { trpc } from "~/lib/trpc";
import { type RecentEntry, usePinnedList, useRecentList } from "~/stores/recents";
import { updateSettings, useSettings } from "~/stores/settings";
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
  const width = useSettings((state) => state.settings.layout.sidebarWidth);
  const [filter, setFilter] = React.useState("");

  const clusters = useQuery(trpc.ecs.clusters.queryOptions(scope));
  const kubeVirt = useKubeDiagnostics().data?.kubeVirt ?? false;
  // Both lists are scoped to the profile and region in view, so switching
  // account empties them rather than offering somewhere you cannot go.
  const pinned = usePinnedList(SIDEBAR_CAP);
  const recent = useRecentList(SIDEBAR_CAP);

  const visible = React.useMemo(() => {
    const query = filter.trim().toLowerCase();
    const rows = clusters.data ?? [];
    return query ? rows.filter((c) => c.name.toLowerCase().includes(query)) : rows;
  }, [clusters.data, filter]);

  return (
    // One scroll region for the whole rail rather than a pinned nav above a
    // scrolling list. The nav is as tall as the registry makes it, and on a
    // short window - or once pinned and recent rows join it - a nav that could
    // not scroll simply lost its bottom rows: Settings and Diagnostics were
    // clipped off the end with no way to reach them.
    // The handle sits on this element rather than inside the scrolling one:
    // an absolutely positioned child of a scroll container is placed against
    // the scrolled content, so it would slide away up the page and only cover
    // the first screenful of a rail that is taller than the window.
    <div style={{ width }} className="relative flex shrink-0">
      {/* The rail's own trailing edge, so the thing being dragged is the thing
          that moves. The width is a preference like the dock's height, which
          is why it lives in settings and follows you to the desktop app rather
          than being forgotten on reload. */}
      <ResizeHandle
        label="the sidebar"
        orientation="vertical"
        size={width}
        onResize={(next) => updateSettings({ layout: { sidebarWidth: next } })}
        min={MIN_SIDEBAR_WIDTH}
        max={MAX_SIDEBAR_WIDTH}
        className="right-0"
      />

      <aside className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r border-border bg-chrome">
        <nav className="flex shrink-0 flex-col gap-px px-2.5 pt-3 pb-2">
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
                {visibleSections(service, { kubeVirt }).map((section) => (
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

        {/* Hidden when empty rather than shown as an empty state: a rail that
            is all headings on a fresh install teaches nothing, and these two
            fill themselves in the course of using the app. */}
        <RefSection title="Pinned" rows={pinned} here={location.href} pinned />
        <RefSection title="Recent" rows={recent} here={location.href} />

        <SectionHeader
          title="Clusters"
          count={clusters.data ? visible.length : "—"}
          className="mx-3.5 mt-2 mb-1.5"
        />

        <div className="shrink-0 px-2.5 pb-2">
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter clusters…"
            className="h-7 w-full rounded-md border border-border bg-background/50 px-2.5 text-[12px] placeholder:text-muted-foreground/55 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </div>

        <div className="flex shrink-0 flex-col gap-px px-2 pb-3">
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
            const to = `/ecs/clusters/${encodeURIComponent(cluster.name)}`;
            const busy = cluster.pendingTasks > 0;
            return (
              <div key={cluster.arn} className="group flex items-center gap-0.5">
                <EntityRow
                  dense
                  to={to}
                  active={location.pathname.startsWith(to)}
                  icon={
                    <StatusDot
                      tone={
                        cluster.status === "ACTIVE" ? (busy ? "warning" : "success") : "neutral"
                      }
                      pulse={busy}
                    />
                  }
                  label={cluster.name}
                  actions={
                    <span className="font-mono text-[10px] text-muted-foreground tabular">
                      {cluster.activeServices}·{cluster.runningTasks}
                    </span>
                  }
                  className="min-w-0 flex-1"
                />
                <PinButton quiet target={clusterRef(cluster.name, scope)} />
              </div>
            );
          })}

          {clusters.isSuccess && visible.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11.5px] text-muted-foreground">
              {filter ? "No matches." : "No clusters in this region."}
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

/**
 * Rows per remembered list in the rail.
 *
 * About what fits above the cluster list on a laptop window, and about as many
 * rows as anyone scans without starting to read.
 */
const SIDEBAR_CAP = 8;

/**
 * One remembered list, or nothing at all.
 *
 * The rows link by their stored `to` rather than rebuilding a route from the
 * id, which is what lets one component draw a bucket at a prefix, an ECS
 * service and an SSH host without knowing anything about any of them.
 */
function RefSection({
  title,
  rows,
  here,
  pinned = false,
}: {
  title: string;
  rows: ReadonlyArray<RecentEntry>;
  /** The current path *with* its search, which is what a stored `to` is. */
  here: string;
  /** Every row here is pinned, so the mark only shows on hover, as a way to unpin. */
  pinned?: boolean;
}) {
  if (rows.length === 0) return null;

  return (
    <>
      <SectionHeader title={title} className="mx-3.5 mt-2 mb-1" />
      <div className="flex shrink-0 flex-col gap-px px-2 pb-1">
        {rows.map((row) => {
          const Icon = kindIcon(row.kind);
          return (
            <div key={row.to} className="group flex items-center gap-0.5">
              <EntityRow
                dense
                to={row.to}
                // Compared against the search too, not just the path: two
                // prefixes in one bucket are two rows, and only one of them is
                // the one being looked at.
                active={here === row.to}
                icon={<Icon className="size-3.5 shrink-0" strokeWidth={1.8} />}
                label={row.label}
                // The second line goes in the tooltip rather than under the
                // name: the rail is eight rows deep at most and a bucket's
                // prefix is longer than the rail is wide.
                title={row.detail ? `${row.label} - ${row.detail}` : row.label}
                className="min-w-0 flex-1"
              />
              <PinButton
                quiet
                target={row}
                className={cn(
                  pinned && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                )}
              />
            </div>
          );
        })}
      </div>
    </>
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
