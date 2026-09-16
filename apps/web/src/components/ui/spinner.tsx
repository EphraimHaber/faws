import { Loader2 } from "lucide-react";

import { cn } from "~/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-3.5 animate-spin text-muted-foreground", className)} />;
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-px p-3">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-8 animate-pulse rounded bg-muted"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
