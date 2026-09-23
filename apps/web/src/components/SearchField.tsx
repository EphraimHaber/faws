import { classifyQuery, type QueryShape } from "@faws/shared";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { Search, Telescope, X } from "lucide-react";
import * as React from "react";

import { Badge } from "~/components/ui/badge";
import { Kbd } from "~/components/ui/kbd";
import { describe } from "~/lib/hotkeys";
import { useOverlaysOpen } from "~/stores/overlays";
import { cn } from "~/lib/utils";

/**
 * Which set of keys a box searches.
 *
 * `loaded` is the rows already in the browser; `remote` is a request to the
 * server that walks keys nobody has paid to look at yet. The S3 object browser
 * stacks one of each, and until they were labelled the only way to know which
 * was which was to type into one and watch what happened - by which point the
 * expensive one has already run.
 */
export type SearchSurface = "loaded" | "remote";

const SURFACE_LABEL: Record<SearchSurface, string> = {
  loaded: "loaded rows",
  remote: "every key",
};

/** What the badge says about the query as typed; empty queries get none. */
const SHAPE_BADGE: Record<
  Exclude<QueryShape, "empty">,
  { readonly text: string; readonly tone: "neutral" | "info"; readonly deep: boolean }
> = {
  substring: { text: "substring", tone: "neutral", deep: false },
  "glob-shallow": { text: "glob", tone: "info", deep: false },
  "glob-deep": { text: "crosses folders", tone: "info", deep: true },
};

/**
 * A search box that says what it searches and what it is about to do.
 *
 * Two things ride with the input rather than beside it. The surface is a label,
 * because "which of these two boxes is the one that costs money" is not a
 * question anyone should answer from memory. The shape is a badge derived from
 * the query itself, because `*.json` and `**\/*.json` look nearly identical
 * and mean "here" and "everywhere below".
 *
 * `onSubmit` is what separates a live box from an applied one. Absent, every
 * keystroke is the search. Present, the text is only a draft until Enter - the
 * shape a billed scan has to have, and the reason a link carrying one arrives
 * filled in and idle.
 */
export function SearchField({
  value,
  onChange,
  onSubmit,
  surface,
  label,
  placeholder,
  hint,
  actions,
  count,
  total,
  hotkey = false,
  inputClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Present makes the field explicit-apply; absent leaves it live. */
  onSubmit?: (() => void) | undefined;
  surface: SearchSurface;
  /** Overrides the surface's own wording where the page can say it better. */
  label?: string | undefined;
  placeholder?: string | undefined;
  /** A line under the field: what the query will do, or what went wrong. */
  hint?: React.ReactNode | undefined;
  /** Controls that belong to this search, such as run, stop and export. */
  actions?: React.ReactNode | undefined;
  count?: number | undefined;
  total?: number | undefined;
  /** Whether `/` focuses this field. Only one per page should claim it. */
  hotkey?: boolean | undefined;
  inputClassName?: string | undefined;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [focused, setFocused] = React.useState(false);
  const overlayOpen = useOverlaysOpen();
  const fieldId = React.useId();

  const focusBinding: UseHotkeyDefinition = {
    hotkey: "/",
    callback: () => ref.current?.focus(),
    options: { enabled: !overlayOpen, meta: describe("Table", "Filter rows") },
  };

  const clearBinding: UseHotkeyDefinition = {
    // Escape belongs to the field only while the field has focus; the root
    // layout owns it otherwise, and registering on focus is what keeps the two
    // from both firing.
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
  };

  // `/` is registered only where it is claimed. Two fields can be on screen at
  // once - the object browser has one of each surface - and the second, unused
  // registration would be a conflict over a key only one of them answers to.
  useHotkeys(hotkey ? [focusBinding, clearBinding] : [clearBinding], { preventDefault: true });

  const typed = value.trim().length > 0;
  const shape = classifyQuery(value);
  const badge = shape === "empty" ? null : SHAPE_BADGE[shape];

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <label
          htmlFor={fieldId}
          className="shrink-0 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
        >
          {label ?? SURFACE_LABEL[surface]}
        </label>

        <div className="relative flex min-w-0 items-center">
          <Search
            className="pointer-events-none absolute left-2.5 size-3 text-muted-foreground/60"
            strokeWidth={1.9}
          />
          <input
            id={fieldId}
            ref={ref}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (onSubmit && event.key === "Enter") onSubmit();
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            className={cn(
              "h-7 w-72 max-w-full rounded-md border border-border bg-background/60 pl-7 pr-16 text-[12.5px] placeholder:text-muted-foreground/55 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15",
              typed && "border-primary/45",
              inputClassName,
            )}
          />
          <span className="absolute right-2 flex items-center gap-1.5">
            {typed ? (
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
            ) : hotkey ? (
              <Kbd>/</Kbd>
            ) : null}
          </span>
        </div>

        {badge ? (
          <Badge tone={badge.tone} className="shrink-0">
            {badge.deep ? <Telescope className="size-3" strokeWidth={1.9} /> : null}
            {badge.text}
          </Badge>
        ) : null}

        {actions}
      </div>

      {hint ? (
        <span className="flex items-center gap-3 font-mono text-[10.5px] text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
