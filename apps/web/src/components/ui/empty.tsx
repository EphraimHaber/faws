import type { LucideIcon } from "lucide-react";
import type * as React from "react";

export function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  /** A sentence, or inline content such as a sentence with an ARN in it. */
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <Icon className="size-5 text-muted-foreground/45" strokeWidth={1.6} />
      <p className="text-[13px] text-foreground">{title}</p>
      {hint ? <p className="max-w-sm text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
