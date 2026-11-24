import type * as React from "react";

import { cn } from "~/lib/utils";

export type SwitchProps = Omit<React.ComponentProps<"button">, "onChange" | "role"> & {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
};

/** An on/off control that says which it is to a screen reader as well as by eye. */
export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "block size-3 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-[15px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}
