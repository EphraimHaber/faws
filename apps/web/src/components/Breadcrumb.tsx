import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import * as React from "react";

import { AWS_SERVICES } from "~/services/registry";
import { cn } from "~/lib/utils";

export interface Crumb {
  readonly label: string;
  /** Every crumb has a destination — including the last one. */
  readonly to: string;
}

/**
 * The trail, derived from the pathname.
 *
 * Each crumb is a real link, the current page included: a breadcrumb whose
 * last item is dead text is a dead end, and on a detail page "go back to this
 * same thing" is how you drop a filter or reset a tab. Intermediate segments
 * that aren't routes of their own resolve to the nearest ancestor that is, so
 * nothing in the trail is ever unclickable.
 */
export function Breadcrumb() {
  const { location } = useRouterState();
  const crumbs = React.useMemo(() => deriveCrumbs(location.pathname), [location.pathname]);
  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={crumb.to} className="flex min-w-0 items-center gap-1.5">
            {index > 0 ? (
              <ChevronRight
                className="size-3 shrink-0 text-muted-foreground/40"
                strokeWidth={1.9}
              />
            ) : null}
            <Link
              to={crumb.to}
              aria-current={isLast ? "page" : undefined}
              className={cn(
                "truncate rounded px-0.5 transition-colors hover:text-foreground",
                isLast ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {crumb.label}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}

export function deriveCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: "Overview", to: "/" }];

  // Every trail starts at the account overview, so there is always a way up.
  const home: Crumb = { label: "Overview", to: "/" };

  const service = AWS_SERVICES.find((entry) => entry.id === segments[0]);
  if (!service) {
    // Shell-level routes (diagnostics, settings) are one level deep.
    const label = segments[0] === "logs" ? "Diagnostics" : titleCase(segments[0] ?? "");
    return [home, { label, to: `/${segments[0]}` }];
  }

  const crumbs: Crumb[] = [home, { label: service.label, to: service.basePath }];

  // /ecs/deployments
  if (segments[1] === "deployments") {
    crumbs.push({ label: "Recently deployed", to: `${service.basePath}/deployments` });
    return crumbs;
  }

  // /ecs/task-definitions
  if (segments[1] === "task-definitions") {
    crumbs.push({ label: "Task definitions", to: `${service.basePath}/task-definitions` });
    return crumbs;
  }

  // /ecs/clusters and /ecs/clusters/$cluster/...
  if (segments[1] === "clusters") {
    crumbs.push({ label: "Clusters", to: `${service.basePath}/clusters` });
  }
  if (segments[1] === "clusters" && segments[2]) {
    const cluster = decodeURIComponent(segments[2]);
    const clusterPath = `${service.basePath}/clusters/${segments[2]}`;
    crumbs.push({ label: cluster, to: clusterPath });

    if (segments[3] === "services" && segments[4]) {
      crumbs.push({
        label: decodeURIComponent(segments[4]),
        to: `${clusterPath}/services/${segments[4]}`,
      });
    } else if (segments[3] === "tasks" && segments[4]) {
      const taskId = decodeURIComponent(segments[4]);
      crumbs.push({
        label: `task ${taskId.slice(0, 12)}`,
        to: `${clusterPath}/tasks/${segments[4]}`,
      });
    }
  }

  return crumbs;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
