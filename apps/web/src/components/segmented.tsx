import { cn } from "~/lib/utils";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly count?: number | undefined;
}

/** Tab strip used for the detail-pane sections and the task status filter. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-0.5 rounded-md bg-muted p-0.5", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-[12px] transition-colors",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  "font-mono text-[10px] tabular",
                  active ? "text-muted-foreground" : "text-muted-foreground/70",
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
