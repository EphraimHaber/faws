import { useHotkeys } from "@tanstack/react-hotkeys";
import { Search, X } from "lucide-react";
import * as React from "react";

import { Kbd } from "~/components/ui/kbd";
import { describe } from "~/lib/hotkeys";
import { useOverlaysOpen } from "~/stores/overlays";
import { cn } from "~/lib/utils";

/**
 * The filter bar that sits above every table. `/` focuses it and Escape
 * clears it — the TUI contract — but it stays visible instead of appearing
 * as a modal line, so you can always see whether a filter is active.
 */
export function FilterInput({
  value,
  onChange,
  placeholder = "Filter… (try service:api)",
  count,
  total,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  count?: number;
  total?: number;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [focused, setFocused] = React.useState(false);
  const overlayOpen = useOverlaysOpen();

  useHotkeys(
    [
      {
        hotkey: "/",
        callback: () => ref.current?.focus(),
        options: { enabled: !overlayOpen, meta: describe("Table", "Filter rows") },
      },
      {
        // Escape belongs to the filter only while the filter has focus; the
        // root layout owns it otherwise, and registering on focus is what
        // keeps the two from both firing.
        hotkey: "Escape",
        callback: () => {
          onChange("");
          ref.current?.blur();
        },
        options: {
          enabled: focused,
          ignoreInputs: false,
          conflictBehavior: "allow",
          meta: describe("Table", "Clear filter"),
        },
      },
    ],
    { preventDefault: true },
  );

  const filtering = value.trim().length > 0;

  return (
    <div className="relative flex items-center">
      <Search
        className="pointer-events-none absolute left-2.5 size-3 text-muted-foreground/60"
        strokeWidth={1.9}
      />
      <input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className={cn(
          "h-7 w-72 rounded-md border border-border bg-background/60 pl-7 pr-16 text-[12.5px] placeholder:text-muted-foreground/55 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15",
          filtering && "border-primary/45",
        )}
      />
      <span className="absolute right-2 flex items-center gap-1.5">
        {filtering ? (
          <>
            {count !== undefined && total !== undefined ? (
              <span className="font-mono text-[10px] text-muted-foreground tabular">
                {count}/{total}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="Clear filter"
              className="grid size-4 cursor-pointer place-items-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          </>
        ) : (
          <Kbd>/</Kbd>
        )}
      </span>
    </div>
  );
}
