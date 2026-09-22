import { useHotkeys } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Boxes, CornerDownLeft, Layers, ScrollText, Settings2, TerminalSquare } from "lucide-react";
import * as React from "react";

import {
  entryText,
  groupBoost,
  navEntries,
  refEntries,
  shellEntries,
  type PaletteEntry,
} from "~/components/CommandPalette.entries";
import { Kbd } from "~/components/ui/kbd";
import { rankBy } from "~/lib/rank";
import { useAwsScope } from "~/contexts/ScopeContext";
import { trpc } from "~/lib/trpc";
import { useOverlay } from "~/stores/overlays";
import { usePinnedList, useRecentList } from "~/stores/recents";
import { cn } from "~/lib/utils";

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
  onOpenTerminal,
  onOpenSsh,
}: {
  open: boolean;
  onClose: () => void;
  activeCluster: string | null;
  onOpenTerminal: () => void;
  onOpenSsh: () => void;
}) {
  // Mounting the body only while open is what keeps the query text and the
  // highlighted row fresh on every invocation, with no reset bookkeeping.
  if (!open) return null;
  return (
    <PaletteBody
      onClose={onClose}
      activeCluster={activeCluster}
      onOpenTerminal={onOpenTerminal}
      onOpenSsh={onOpenSsh}
    />
  );
}

function PaletteBody({
  onClose,
  activeCluster,
  onOpenTerminal,
  onOpenSsh,
}: {
  onClose: () => void;
  onOpenTerminal: () => void;
  onOpenSsh: () => void;
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

  const pinned = usePinnedList();
  // Capped well below the palette's own 40-row limit: past a dozen, "where I
  // have just been" stops being a short list you recognise and starts being a
  // history you have to read.
  const recent = useRecentList(12);

  const clusters = useQuery(trpc.ecs.clusters.queryOptions(scope));
  const services = useQuery({
    ...trpc.ecs.services.queryOptions({ ...scope, cluster: activeCluster ?? "" }),
    enabled: Boolean(activeCluster),
  });

  const entries = React.useMemo<PaletteEntry[]>(() => {
    const go = (to: string) => void navigate({ to: to as never });

    const out: PaletteEntry[] = [
      {
        id: "terminal:open",
        icon: TerminalSquare,
        label: "Open a terminal",
        hint: "shell into an EC2 instance",
        keywords: ["shell", "console", "ssm", "exec", "bash"],
        group: "action",
        run: onOpenTerminal,
      },
      {
        id: "terminal:ssh",
        icon: TerminalSquare,
        label: "SSH to a host",
        hint: "a hostname, or an entry from ~/.ssh/config",
        keywords: ["ssh", "shell", "host", "remote"],
        group: "action",
        run: onOpenSsh,
      },
      ...refEntries(pinned, "pinned", go),
      ...refEntries(recent, "recent", go),
      ...navEntries(go),
      ...shellEntries(go, { diagnostics: ScrollText, settings: Settings2 }),
    ];

    for (const cluster of clusters.data ?? []) {
      out.push({
        id: `cluster:${cluster.arn}`,
        icon: Layers,
        label: cluster.name,
        hint: `cluster \u00b7 ${cluster.activeServices} services`,
        keywords: ["cluster"],
        group: "resource",
        run: () =>
          void navigate({ to: "/ecs/clusters/$cluster", params: { cluster: cluster.name } }),
      });
    }

    for (const service of services.data ?? []) {
      out.push({
        id: `service:${service.arn}`,
        icon: Boxes,
        label: service.name,
        hint: `service \u00b7 ${service.clusterName}`,
        keywords: ["service", service.clusterName],
        group: "resource",
        run: () =>
          void navigate({
            to: "/ecs/clusters/$cluster/services/$service",
            params: { cluster: service.clusterName, service: service.name },
          }),
      });
    }

    return out;
  }, [clusters.data, services.data, pinned, recent, navigate, onOpenTerminal, onOpenSsh]);

  // Ranked rather than filtered. A subsequence test answers "could these
  // letters be found in order", which is a fine filter and no order at all:
  // typing `inst` used to leave "Instances" wherever it happened to sit in the
  // array. `rankBy` keeps every match the old test would have kept.
  const matches = React.useMemo(
    () => rankBy(entries, query, entryText, groupBoost).slice(0, 40),
    [entries, query],
  );

  function choose(entry: PaletteEntry | undefined) {
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
