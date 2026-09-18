import { useHotkeys } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Boxes,
  Container,
  CornerDownLeft,
  Database,
  FileJson,
  Layers,
  LayoutDashboard,
  HardDrive,
  Rocket,
  ScrollText,
  Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { Kbd } from "~/components/ui/kbd";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";
import { useOverlay } from "~/stores/overlays";
import { cn } from "~/lib/utils";

interface Entry {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly hint: string;
  readonly run: () => void;
}

/**
 * Cmd+K jump-to.
 *
 * In a TUI, reaching a service means walking the cluster list, entering it,
 * then filtering. Here every cluster and every service in the open cluster is
 * one fuzzy match away, which is the flow this app is built around.
 */
export function CommandPalette({
  open,
  onClose,
  activeCluster,
}: {
  open: boolean;
  onClose: () => void;
  activeCluster: string | null;
}) {
  // Mounting the body only while open is what keeps the query text and the
  // highlighted row fresh on every invocation, with no reset bookkeeping.
  if (!open) return null;
  return <PaletteBody onClose={onClose} activeCluster={activeCluster} />;
}

function PaletteBody({
  onClose,
  activeCluster,
}: {
  onClose: () => void;
  activeCluster: string | null;
}) {
  const scope = useAwsScope();
  const { isTop } = useOverlay("command-palette", true);

  useHotkeys(
    [
      {
        hotkey: "Escape",
        callback: onClose,
        options: { enabled: isTop, conflictBehavior: "allow" },
      },
    ],
    { preventDefault: true },
  );
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  const [index, setIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const clusters = useQuery(trpc.ecs.clusters.queryOptions(scope));
  const services = useQuery({
    ...trpc.ecs.services.queryOptions({ ...scope, cluster: activeCluster ?? "" }),
    enabled: Boolean(activeCluster),
  });

  const entries = React.useMemo<Entry[]>(() => {
    const out: Entry[] = [
      {
        id: "nav:home",
        icon: LayoutDashboard,
        label: "Overview",
        hint: "account summary",
        run: () => void navigate({ to: "/" }),
      },
      {
        id: "nav:ecs",
        icon: Container,
        label: "ECS",
        hint: "section overview",
        run: () => void navigate({ to: "/ecs" }),
      },
      {
        id: "nav:clusters",
        icon: Layers,
        label: "Clusters",
        hint: "every cluster in the region",
        run: () => void navigate({ to: "/ecs/clusters" }),
      },
      {
        id: "nav:deployments",
        icon: Rocket,
        label: "Recently deployed",
        hint: "rollouts across the region",
        run: () => void navigate({ to: "/ecs/deployments" }),
      },
      {
        id: "nav:task-definitions",
        icon: FileJson,
        label: "Task definitions",
        hint: "registry",
        run: () => void navigate({ to: "/ecs/task-definitions" }),
      },
      {
        id: "nav:s3",
        icon: HardDrive,
        label: "S3",
        hint: "section overview",
        run: () => void navigate({ to: "/s3" }),
      },
      {
        id: "nav:buckets",
        icon: Database,
        label: "Buckets",
        hint: "every bucket in the account",
        run: () => void navigate({ to: "/s3/buckets" }),
      },
      {
        id: "nav:logs",
        icon: ScrollText,
        label: "Diagnostics",
        hint: "faws server logs",
        run: () => void navigate({ to: "/logs" }),
      },
      {
        id: "nav:settings",
        icon: Settings2,
        label: "Settings",
        hint: "preferences",
        run: () => void navigate({ to: "/settings" }),
      },
    ];

    for (const cluster of clusters.data ?? []) {
      out.push({
        id: `cluster:${cluster.arn}`,
        icon: Layers,
        label: cluster.name,
        hint: `cluster · ${cluster.activeServices} services`,
        run: () =>
          void navigate({ to: "/ecs/clusters/$cluster", params: { cluster: cluster.name } }),
      });
    }

    for (const service of services.data ?? []) {
      out.push({
        id: `service:${service.arn}`,
        icon: Boxes,
        label: service.name,
        hint: `service · ${service.clusterName}`,
        run: () =>
          void navigate({
            to: "/ecs/clusters/$cluster/services/$service",
            params: { cluster: service.clusterName, service: service.name },
          }),
      });
    }

    return out;
  }, [clusters.data, services.data, navigate]);

  const matches = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries.slice(0, 40);
    return entries.filter((entry) => fuzzyMatch(entry.label.toLowerCase(), needle)).slice(0, 40);
  }, [entries, query]);

  function choose(entry: Entry | undefined) {
    if (!entry) return;
    entry.run();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 pt-[12vh] backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Close palette"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-[min(620px,92vw)] rounded-xl border border-border bg-popover shadow-2xl">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            // A new query means a new result list; the cursor belongs at the
            // top of it.
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
              event.preventDefault();
              setIndex((prev) => Math.min(matches.length - 1, prev + 1));
            }
            if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
              event.preventDefault();
              setIndex((prev) => Math.max(0, prev - 1));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              choose(matches[index]);
            }
          }}
          placeholder="Jump to a cluster, service or view…"
          className="h-12 w-full rounded-t-xl border-b border-border bg-transparent px-4 text-[14px] placeholder:text-muted-foreground/55 focus:outline-none"
        />
        <div className="max-h-[52vh] overflow-auto p-1.5">
          {matches.map((entry, position) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                onMouseEnter={() => setIndex(position)}
                onClick={() => choose(entry)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  position === index ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{entry.label}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/75">
                  {entry.hint}
                </span>
                {position === index ? (
                  <CornerDownLeft className="size-3 shrink-0 text-muted-foreground" />
                ) : null}
              </button>
            );
          })}
          {matches.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-muted-foreground">No matches.</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 rounded-b-xl border-t border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

/** Subsequence match: "apsv" finds "api-service". */
function fuzzyMatch(haystack: string, needle: string): boolean {
  let position = 0;
  for (const char of needle) {
    position = haystack.indexOf(char, position);
    if (position === -1) return false;
    position += 1;
  }
  return true;
}
