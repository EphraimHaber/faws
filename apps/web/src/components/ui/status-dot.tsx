import { cn } from "~/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClass: Record<StatusTone, string> = {
  success: "bg-success text-success",
  warning: "bg-warning text-warning",
  danger: "bg-danger text-danger",
  info: "bg-info text-info",
  neutral: "bg-muted-foreground/60 text-muted-foreground",
};

/**
 * The single densest signal in the app: one dot per row. `pulse` adds a
 * breathing ring for anything actively in motion (a rolling deployment, a
 * task still starting), so movement on screen always means movement in AWS.
 */
export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: StatusTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block size-[7px] shrink-0 rounded-full",
        toneClass[tone],
        pulse && "pulse-ring",
        className,
      )}
    />
  );
}
