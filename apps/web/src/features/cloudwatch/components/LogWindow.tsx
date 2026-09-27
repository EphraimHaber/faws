import { CLOUDWATCH_WINDOWS, type CloudWatchWindow, windowLabel } from "@faws/contracts";

import { Segmented } from "~/components/segmented";
import { cn } from "~/lib/utils";

/** How far back a CloudWatch view reads, from the fixed set it offers. */
export function WindowPicker({
  value,
  onChange,
}: {
  value: CloudWatchWindow;
  onChange: (next: CloudWatchWindow) => void;
}) {
  return (
    <Segmented<`${CloudWatchWindow}`>
      value={`${value}`}
      onChange={(next) => onChange(Number(next) as CloudWatchWindow)}
      options={CLOUDWATCH_WINDOWS.map((minutes) => ({
        value: `${minutes}` as const,
        label: windowLabel(minutes),
      }))}
    />
  );
}

/**
 * Says which part of a window a read left out, so its oldest lines are never
 * passed off as the newest.
 */
export function TruncatedNote({
  truncated,
  count,
  windowMinutes,
  group,
  className,
}: {
  truncated: "older" | "newer";
  count: number;
  windowMinutes: CloudWatchWindow;
  /** Names the group when the note is one of several. */
  group?: string;
  className?: string;
}) {
  const subject = group ? `${group}: ` : "";
  return (
    <p
      className={cn(
        "border-b border-border bg-warning/8 px-3.5 py-1.5 text-[11.5px] text-warning",
        className,
      )}
    >
      {subject}
      {truncated === "older"
        ? `the newest ${count} lines in the last ${windowLabel(windowMinutes)}; earlier ones are left out.`
        : "this window is too busy to read to the end, so these are its oldest lines. A shorter window or a filter reaches the newest."}
    </p>
  );
}
