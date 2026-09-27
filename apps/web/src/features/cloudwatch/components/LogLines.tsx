import type { LogEvent } from "@faws/contracts";
import { ArrowDown, ArrowUp, Clock, Eye, EyeOff, Pause, Play } from "lucide-react";
import * as React from "react";

import { Button } from "~/components/ui/button";
import { ResizeHandle } from "~/components/ui/resize-handle";
import { MIN_LOG_GUTTER, useScope } from "~/contexts/ScopeContext";
import { LogLine } from "~/features/ecs/components/LogLine";
import { useSearchState } from "~/hooks/useSearchState";
import { hasAnsi } from "~/lib/ansi";
import { clockTime, fullTimestamp } from "~/lib/format";
import { cn } from "~/lib/utils";

/** A line, and the group it came from when several are read at once. */
export interface ShownEvent extends LogEvent {
  readonly group?: string;
}

export type LogOrder = "asc" | "desc";

/** Tail cadence when the app-wide refresh is set to manual. */
export const TAIL_INTERVAL_MS = 10_000;

/** The body's padding and the gap between its columns, in px - the drag
 *  handles sit on top of the lines, so they need both. */
const LOG_PANE_PADDING = 12;
const LOG_COLUMN_GAP = 10;

/**
 * A panel-wide toggle that lives in the URL as `<key>=hidden`, so a reading
 * preference survives a reload and travels with a link. Shown is the absent
 * param, the same convention the ECS log pane's task column follows.
 */
export function useShownSearch(key: string): readonly [boolean, () => void] {
  const [hidden, setHidden] = useSearchState<boolean>({
    key,
    fallback: false,
    parse: (raw) => raw === "hidden",
    serialize: (value) => (value ? "hidden" : undefined),
  });
  return [!hidden, () => setHidden(!hidden)] as const;
}

/**
 * Tail, stream column, timestamp and order: the controls every CloudWatch log
 * view shares, in the order the ECS log pane puts them.
 */
export function LogViewControls({
  tail,
  onToggleTail,
  showStream,
  onToggleStream,
  order,
  onToggleOrder,
}: {
  tail: boolean;
  onToggleTail: () => void;
  /** Absent when there is only one stream to show, so no column to hide. */
  showStream?: boolean;
  onToggleStream?: () => void;
  order: LogOrder;
  onToggleOrder: () => void;
}) {
  const { logTimestamps, setLogTimestamps } = useScope();

  return (
    <>
      <Button
        type="button"
        variant={tail ? "default" : "outline"}
        onClick={onToggleTail}
        title={tail ? "Stop following new lines" : "Follow new lines as they arrive"}
      >
        {tail ? <Pause className="size-3" /> : <Play className="size-3" />}
        {tail ? "Tailing" : "Tail"}
      </Button>
      {onToggleStream ? (
        <Button
          type="button"
          variant="outline"
          onClick={onToggleStream}
          title={
            showStream
              ? "Hide the column showing which stream each line came from"
              : "Show which stream each line came from"
          }
        >
          {showStream ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          {showStream ? "Hide streams" : "Show streams"}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        onClick={() => setLogTimestamps(logTimestamps === "full" ? "clock" : "full")}
        title={
          logTimestamps === "full"
            ? "Show clock time only"
            : "Show the full date and time of each line"
        }
      >
        <Clock className="size-3" />
        {logTimestamps === "full" ? "Full time" : "Clock time"}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onToggleOrder}
        title={
          order === "asc"
            ? "Show the newest line first instead"
            : "Show the oldest line first instead"
        }
      >
        {order === "asc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
        {order === "asc" ? "Oldest first" : "Newest first"}
      </Button>
    </>
  );
}

/**
 * Keeps the newest line in view while tailing. Which end that is follows the
 * order: newest-first grows at the top, oldest-first at the bottom.
 */
export function useFollowNewest(
  bodyRef: React.RefObject<HTMLDivElement | null>,
  lines: ReadonlyArray<unknown>,
  tail: boolean,
  order: LogOrder,
): void {
  React.useEffect(() => {
    const body = bodyRef.current;
    if (!tail || !body || lines.length === 0) return;
    body.scrollTop = order === "asc" ? body.scrollHeight : 0;
  }, [bodyRef, lines, tail, order]);
}

/**
 * The lines themselves.
 *
 * The timestamp and stream columns are sized by the same app-wide settings the
 * ECS log pane writes, so a width chosen in one is the width in the other. A
 * group column appears when lines from several groups are interleaved, tinted
 * per group so the eye can follow one of them down the page.
 */
export function LogLines({
  lines,
  showStream,
  groupTone,
  bodyRef,
  compact = false,
  className,
}: {
  lines: ReadonlyArray<ShownEvent>;
  showStream: boolean;
  /** Present when lines come from more than one group: that group's colour. */
  groupTone?: (group: string) => string;
  bodyRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * For a narrow column beside others: clock time only and short fixed
   * columns, with no drag handles. The app-wide widths are sized for a pane
   * that has the window to itself, and would leave a column no room for the
   * message.
   */
  compact?: boolean;
  className?: string;
}) {
  const scope = useScope();
  const logTimestamps = compact ? "clock" : scope.logTimestamps;
  const logGutter = compact ? COMPACT_TIME_WIDTH : scope.logGutter;
  const logTaskGutter = compact ? COMPACT_STREAM_WIDTH : scope.logTaskGutter;
  const { setLogGutter, setLogTaskGutter } = scope;

  return (
    <div
      ref={bodyRef}
      className={cn(
        "relative min-h-0 flex-1 overflow-auto p-3 font-mono text-[11.5px] leading-relaxed",
        className,
      )}
    >
      {compact ? null : (
        <ResizeHandle
          label="the timestamp column"
          orientation="vertical"
          style={{ left: LOG_PANE_PADDING + logGutter - 4 }}
          size={logGutter}
          min={MIN_LOG_GUTTER}
          onResize={setLogGutter}
        />
      )}
      {showStream && !compact ? (
        <ResizeHandle
          label="the stream column"
          orientation="vertical"
          style={{
            left:
              LOG_PANE_PADDING +
              logGutter +
              LOG_COLUMN_GAP +
              (groupTone ? GROUP_COLUMN_WIDTH + LOG_COLUMN_GAP : 0) +
              logTaskGutter -
              4,
          }}
          size={logTaskGutter}
          min={MIN_LOG_GUTTER}
          onResize={setLogTaskGutter}
        />
      ) : null}
      {lines.map((event) => (
        <div
          key={`${event.group ?? ""}-${event.timestamp}-${event.stream}-${event.message}`}
          className="flex gap-2.5 whitespace-pre-wrap break-words"
        >
          <span
            style={{ width: logGutter }}
            className="shrink-0 truncate text-muted-foreground/60 tabular"
            title={fullTimestamp(event.timestamp)}
          >
            {logTimestamps === "full" ? fullTimestamp(event.timestamp) : clockTime(event.timestamp)}
          </span>
          {groupTone && event.group ? (
            <span
              style={{ width: GROUP_COLUMN_WIDTH }}
              className={cn("shrink-0 truncate", groupTone(event.group))}
              title={event.group}
            >
              {groupTail(event.group)}
            </span>
          ) : null}
          {showStream ? (
            <span
              style={{ width: logTaskGutter }}
              className="shrink-0 truncate text-muted-foreground/70"
              title={event.stream}
            >
              {event.stream.slice(event.stream.lastIndexOf("/") + 1)}
            </span>
          ) : null}
          <LogLine
            text={event.message}
            className={cn(
              // The message gives way to the columns beside it: without a zero
              // min-width its own content is a floor.
              "min-w-0 flex-1",
              // Only tint the line when the program didn't already colour it.
              !hasAnsi(event.message) &&
                /error|exception|fatal/i.test(event.message) &&
                "text-danger",
            )}
          />
        </div>
      ))}
    </div>
  );
}

const GROUP_COLUMN_WIDTH = 128;
const COMPACT_TIME_WIDTH = 64;
const COMPACT_STREAM_WIDTH = 72;

/** The last segment of a group's name, which is the part that tells groups apart. */
export function groupTail(group: string): string {
  const trimmed = group.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || group;
}

/**
 * One colour per group being tailed together, by position. Ten, because ten
 * is as many groups as are read at once.
 */
const GROUP_TONES = [
  "text-sky-600 dark:text-sky-400",
  "text-amber-600 dark:text-amber-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-fuchsia-600 dark:text-fuchsia-400",
  "text-rose-600 dark:text-rose-400",
  "text-violet-600 dark:text-violet-400",
  "text-lime-600 dark:text-lime-400",
  "text-orange-600 dark:text-orange-400",
  "text-cyan-600 dark:text-cyan-400",
  "text-pink-600 dark:text-pink-400",
] as const;

export function groupToneAt(index: number): string {
  return GROUP_TONES[index % GROUP_TONES.length] ?? GROUP_TONES[0];
}
