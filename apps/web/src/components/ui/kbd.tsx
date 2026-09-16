import type * as React from "react";

import { cn } from "~/lib/utils";

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
