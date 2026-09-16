import { useHotkeys } from "@tanstack/react-hotkeys";
import { Pause, RotateCw, Timer } from "lucide-react";

import { Kbd } from "~/components/ui/kbd";
import { REFRESH_CHOICES, useScope } from "~/contexts/ScopeContext";
import { useAutoRefresh } from "~/hooks/useAutoRefresh";
import { describe } from "~/lib/hotkeys";
import { useOverlaysOpen } from "~/stores/overlays";
import { cn } from "~/lib/utils";

/**
 * Footer, in the spirit of e1s's status line: context on the left, the
 * refresh contract in the middle, key hints on the right. The countdown is
 * explicit because silent background polling is how a console lies to you
 * about how fresh the numbers are.
 */
export function StatusBar({ onShowHelp }: { onShowHelp: () => void }) {
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
