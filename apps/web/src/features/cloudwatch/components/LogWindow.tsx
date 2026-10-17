import {
  CLOUDWATCH_WINDOWS,
  type CloudWatchWindow,
  type LogEventWindow,
  windowLabel,
} from "@faws/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import type * as React from "react";

import { Segmented } from "~/components/segmented";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { LoadingRows } from "~/components/ui/spinner";
import { LogLines, type ShownEvent } from "~/features/cloudwatch/components/LogLines";
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

/**
 * One group's read of a window, below its toolbar: a note when the read left
 * lines out, then the lines, or a sentence saying the window has none.
 */
export function LogWindowView({
  logs,
  lines,
  windowMinutes,
  showStream,
  bodyRef,
  emptyHint = "A longer window may reach something.",
}: {
  logs: UseQueryResult<LogEventWindow, unknown>;
  /** The read's events in the order they are shown. */
  lines: ReadonlyArray<ShownEvent>;
  windowMinutes: CloudWatchWindow;
  showStream: boolean;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  emptyHint?: string;
}) {
  return (
    <>
      {logs.data?.truncated ? (
        <TruncatedNote
          truncated={logs.data.truncated}
          count={lines.length}
          windowMinutes={windowMinutes}
        />
      ) : null}
      {logs.isPending ? (
        <LoadingRows rows={10} />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
      ) : lines.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={`No log events in the last ${windowLabel(windowMinutes)}`}
          hint={emptyHint}
        />
      ) : (
        <LogLines lines={lines} showStream={showStream} bodyRef={bodyRef} />
      )}
    </>
  );
}
