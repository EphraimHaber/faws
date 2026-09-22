import { useHotkeys } from "@tanstack/react-hotkeys";
import { useRouterState } from "@tanstack/react-router";
import { Pause, RotateCw, TerminalSquare, Timer } from "lucide-react";

import { Kbd } from "~/components/ui/kbd";
import { REFRESH_CHOICES, useKubeScope, useScope } from "~/contexts/ScopeContext";
import { useAutoRefresh } from "~/hooks/useAutoRefresh";
import { describe } from "~/lib/hotkeys";
import { useSessions } from "~/stores/sessions";
import { useOverlaysOpen } from "~/stores/overlays";
import { cn } from "~/lib/utils";

/**
 * Footer, in the spirit of e1s's status line: context on the left, the
 * refresh contract in the middle, key hints on the right. The countdown is
 * explicit because silent background polling is how a console lies to you
 * about how fresh the numbers are.
 */
export function StatusBar({
  onShowHelp,
  onOpenTerminal,
}: {
  onShowHelp: () => void;
  onOpenTerminal: () => void;
}) {
  const sessionCount = useSessions((state) => state.sessions.length);
  const dockOpen = useSessions((state) => state.dockOpen);
  const toggleDock = useSessions((state) => state.toggleDock);
  const { profile, region, refreshSeconds, setRefreshSeconds } = useScope();
  const overlayOpen = useOverlaysOpen();
  const { secondsLeft, refreshNow } = useAutoRefresh();
  const paused = refreshSeconds <= 0;

  useHotkeys(
    [
      {
        hotkey: "R",
        callback: refreshNow,
        options: { meta: describe("Context", "Refresh now") },
      },
    ],
    { preventDefault: true, enabled: !overlayOpen },
  );

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-chrome px-3 font-mono text-[10.5px] text-muted-foreground">
      <span className="text-foreground">{profile}</span>
      <span aria-hidden className="text-muted-foreground/40">
        /
      </span>
      <span className="text-foreground tabular">{region}</span>

      <KubeChip />

      <span aria-hidden className="h-3 w-px bg-border" />

      <button
        type="button"
        onClick={refreshNow}
        title="Refresh now (r)"
        className="flex cursor-pointer items-center gap-1.5 rounded px-1 transition-colors hover:text-foreground"
      >
        <RotateCw className="size-2.5" strokeWidth={2} />
        refresh
      </button>

      <select
        value={refreshSeconds}
        onChange={(event) => setRefreshSeconds(Number(event.target.value))}
        title="Auto-refresh interval"
        className="cursor-pointer rounded bg-transparent px-1 text-[10.5px] text-muted-foreground focus:outline-none"
      >
        {REFRESH_CHOICES.map((choice) => (
          <option key={choice} value={choice}>
            {choice === -1 ? "manual" : `${choice}s`}
          </option>
        ))}
      </select>

      <span
        className={cn(
          "flex items-center gap-1 tabular",
          paused ? "text-muted-foreground/60" : "text-foreground",
        )}
      >
        {paused ? <Pause className="size-2.5" /> : <Timer className="size-2.5" />}
        {paused ? "paused" : `${secondsLeft}s`}
      </span>

      <div className="ml-auto flex items-center gap-3">
        {/* The only always-visible way in. Without it, opening a terminal means
            knowing either the command palette entry or the chord, and a shell
            is not a feature people should have to already know about. */}
        <button
          type="button"
          onClick={() => (sessionCount > 0 ? toggleDock() : onOpenTerminal())}
          title={
            sessionCount > 0
              ? `${dockOpen ? "Hide" : "Show"} the terminal dock (Ctrl+\`)`
              : "Open a terminal (Cmd+Alt+T)"
          }
          className="flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
        >
          <TerminalSquare className="size-3" />
          {sessionCount > 0 ? <span className="tabular">{sessionCount}</span> : null}
          <span>terminal</span>
        </button>
        <span className="flex items-center gap-1">
          <Kbd>/</Kbd> filter
        </span>
        <span className="flex items-center gap-1">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd> move
        </span>
        <button
          type="button"
          onClick={onShowHelp}
          className="flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
        >
          <Kbd>?</Kbd> keys
        </button>
      </div>
    </footer>
  );
}

/**
 * Which cluster the Kubernetes pages are on, while you are on one.
 *
 * Read-only and only here: the place to change it is the picker in those pages'
 * own header, for the reason that picker gives. This is the same job the
 * profile and region pair beside it does - saying what you are looking at
 * without being the thing that moves it - and it is set apart from them
 * deliberately, because the two scopes have nothing to do with each other and a
 * `prod / eu-west-1 / prod-eks` read as a single triple would be a lie.
 */
function KubeChip() {
  const { location } = useRouterState();
  const { context, namespace, ready } = useKubeScope();
  if (!location.pathname.startsWith("/kubernetes") || !ready) return null;

  return (
    <>
      <span aria-hidden className="h-3 w-px bg-border" />
      <span
        className="flex items-center gap-1.5"
        title="The context and namespace these pages read"
      >
        <span className="text-muted-foreground/70">k8s</span>
        <span className="max-w-48 truncate text-foreground">
          {context}/{namespace}
        </span>
      </span>
    </>
  );
}
