import type * as React from "react";

import { cn } from "~/lib/utils";

/** The one content container: a bordered plane that sits above the chrome. */
export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("flex min-h-0 flex-col rounded-lg border border-border bg-card", className)}
      {...props}
    />
  );
}

export function PanelHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "flex h-10 shrink-0 items-center gap-3 border-b border-border px-3.5",
        className,
      )}
      {...props}
    />
  );
}

/** Compact search field for a panel header. */
export function PanelSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="h-6 w-36 rounded border border-border bg-background/50 px-2 text-[11.5px] placeholder:text-muted-foreground/55 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15"
    />
  );
}

export function PanelTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "font-mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}
