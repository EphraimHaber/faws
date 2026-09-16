import { HelpCircle, Search } from "lucide-react";
import * as React from "react";

import { Segmented } from "~/components/segmented";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import {
  type LogFilterMode,
  looksLikePattern,
  PATTERN_EXAMPLES,
  toFilterPattern,
} from "~/lib/log-filter";
import { cn } from "~/lib/utils";

/**
 * Log filtering for both audiences.
 *
 * Search mode quotes what you type, so an IP or a path matches literally.
 * Pattern mode sends CloudWatch's query language verbatim. Whichever is
 * active, the pattern actually sent is shown underneath — that line is what
 * turns the simple mode into a way of learning the other one.
 *
 * Applying is explicit rather than debounced because every apply is a billed
 * CloudWatch query, and a keystroke-per-request search box is a surprising
 * thing to find on a bill.
 */
export function LogFilterBar({
  onApply,
  disabled = false,
}: {
  onApply: (pattern: string | null) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = React.useState<LogFilterMode>("search");
  const [value, setValue] = React.useState("");
  const [showHelp, setShowHelp] = React.useState(false);
  const [focused, setFocused] = React.useState(false);

  const effective = toFilterPattern(value, mode);
  const suggestPattern = mode === "search" && looksLikePattern(value);

  function apply(nextMode: LogFilterMode = mode) {
    onApply(toFilterPattern(value, nextMode));
  }

  return (
    // The pattern line and the syntax help hang below the toolbar rather than
    // sitting in it: a filter bar two rows tall would drag every control
    // beside it out of line with the row it belongs to.
    <div className="relative flex flex-col">
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <Segmented<LogFilterMode>
          value={mode}
          onChange={(next) => {
            setMode(next);
            // Re-run immediately: the same text means something different in
            // the other mode, and leaving stale results on screen under a new
            // mode label is a lie.
            if (value.trim().length > 0) apply(next);
          }}
          options={[
            { value: "search", label: "Search" },
            { value: "pattern", label: "Pattern" },
          ]}
        />

        <span className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 size-3 text-muted-foreground/60" />
          <Input
            value={value}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => setValue(event.target.value)}
            placeholder={
              mode === "search" ? "Find text, e.g. 10-0" : 'Pattern, e.g. {$.level = "error"}'
            }
            className="w-64 pl-7 font-mono"
          />
        </span>

        <Button type="submit" disabled={disabled}>
          Apply
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setValue("");
              onApply(null);
            }}
          >
            Clear
          </Button>
        ) : null}

        <button
          type="button"
          onClick={() => setShowHelp((prev) => !prev)}
          aria-label="Filter pattern syntax"
          title="Filter pattern syntax"
          className={cn(
            "grid size-6 cursor-pointer place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground",
            showHelp && "bg-accent text-foreground",
          )}
        >
          <HelpCircle className="size-3.5" strokeWidth={1.8} />
        </button>
      </form>

      <div className="absolute top-full right-0 z-20 mt-1 flex flex-col items-end gap-1">
        {/* Nothing to say until the box is in use: an idle hint floating over
            the log lines below reads as part of them. */}
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2 py-1 font-mono text-[10px] shadow-lg",
            !focused && !value && "hidden",
          )}
        >
          {effective ? (
            <span className="text-muted-foreground">
              sent as <span className="text-foreground">{effective}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/60">
              <Kbd>↵</Kbd> to apply
            </span>
          )}
          {suggestPattern ? (
            <button
              type="button"
              onClick={() => {
                setMode("pattern");
                apply("pattern");
              }}
              className="cursor-pointer text-warning underline decoration-warning/40 underline-offset-2"
            >
              that looks like a pattern — switch to Pattern mode?
            </button>
          ) : null}
        </div>

        {showHelp ? (
          <dl className="grid gap-x-4 gap-y-1 rounded-md border border-border bg-card p-2.5 shadow-lg sm:grid-cols-2">
            {PATTERN_EXAMPLES.map((example) => (
              <div key={example.pattern} className="flex items-baseline gap-2">
                <dt>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("pattern");
                      setValue(example.pattern);
                    }}
                    className="cursor-pointer rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] whitespace-nowrap transition-colors hover:bg-accent"
                  >
                    {example.pattern}
                  </button>
                </dt>
                <dd className="text-[11px] text-muted-foreground">{example.description}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  );
}
