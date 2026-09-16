import { useHotkeys } from "@tanstack/react-hotkeys";
import { Check, Globe2 } from "lucide-react";
import * as React from "react";

import { useScope } from "~/contexts/ScopeContext";
import { AWS_REGION_GROUPS } from "~/lib/aws-regions";
import { describe } from "~/lib/hotkeys";
import { useOverlay, useOverlaysOpen } from "~/stores/overlays";
import { cn } from "~/lib/utils";

/** Ctrl+R, same as e1s. Type to narrow by code or city name. */
export function RegionPicker() {
  const { region, setRegion } = useScope();
  const [open, setOpen] = React.useState(false);
  const overlayOpen = useOverlaysOpen();
  const { isTop } = useOverlay("region-picker", open);
  const [search, setSearch] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  useHotkeys(
    [
      {
        hotkey: "Control+R",
        callback: () => {
          setSearch("");
          setOpen((prev) => !prev);
        },
        // Not gated on overlays: this is how you leave the picker again.
        options: { enabled: !overlayOpen || open, meta: describe("Context", "Switch region") },
      },
      {
        hotkey: "Escape",
        callback: () => setOpen(false),
        options: { enabled: isTop, conflictBehavior: "allow" },
      },
    ],
    { preventDefault: true },
  );

  const groups = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return AWS_REGION_GROUPS;
    return AWS_REGION_GROUPS.map((group) => ({
      group: group.group,
      regions: group.regions.filter(
        (r) => r.value.includes(query) || r.label.toLowerCase().includes(query),
      ),
    })).filter((group) => group.regions.length > 0);
  }, [search]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setSearch("");
          setOpen((prev) => !prev);
        }}
        title="Switch region (Ctrl+R)"
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Globe2 className="size-3.5 opacity-70" strokeWidth={1.8} />
        <span className="font-mono text-[11.5px] text-foreground tabular">{region || "—"}</span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close region list"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-8 right-0 z-50 w-72 rounded-lg border border-border bg-popover shadow-xl">
            <input
              ref={inputRef}
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const first = groups[0]?.regions[0];
                  if (first) {
                    setRegion(first.value);
                    setOpen(false);
                  }
                }
              }}
              placeholder="Search regions…"
              className="h-9 w-full rounded-t-lg border-b border-border bg-transparent px-3 text-[12.5px] placeholder:text-muted-foreground/55 focus:outline-none"
            />
            <div className="max-h-72 overflow-auto rounded-b-lg p-1">
              {groups.map((group) => (
                <div key={group.group}>
                  <p className="px-2 pt-2 pb-1 font-mono text-[9.5px] tracking-[0.2em] text-muted-foreground uppercase">
                    {group.group}
                  </p>
                  {group.regions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setRegion(option.value);
                        setOpen(false);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
                    >
                      <Check
                        className={cn(
                          "size-3 shrink-0",
                          option.value === region ? "text-primary" : "opacity-0",
                        )}
                      />
                      <span className="font-mono text-[12px]">{option.value}</span>
                      <span className="truncate text-[11px] text-muted-foreground/75">
                        {option.label}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {groups.length === 0 ? (
                <p className="py-5 text-center text-[12px] text-muted-foreground">No matches</p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
