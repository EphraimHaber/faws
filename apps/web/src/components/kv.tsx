import type * as React from "react";

import { cn } from "~/lib/utils";

/** Label/value pairs for detail panes: one column of aligned facts. */
export function KeyValue({
  label,
  children,
  mono = true,
  className,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5 py-1.5", className)}>
      <span className="font-mono text-[9.5px] tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className={cn("text-[12.5px] break-words", mono && "font-mono text-[12px] tabular")}>
        {children}
      </span>
    </div>
  );
}

export function KeyValueGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-x-6 lg:grid-cols-3 xl:grid-cols-4", className)}
      {...props}
    />
  );
}
