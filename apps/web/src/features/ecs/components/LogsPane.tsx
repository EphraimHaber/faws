import type { ContainerLogConfig } from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ExternalLink, FileWarning, ScrollText } from "lucide-react";
import * as React from "react";

import { Segmented } from "~/components/segmented";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { LoadingRows } from "~/components/ui/spinner";
import { LogFilterBar } from "~/features/ecs/components/LogFilterBar";
import { LogLine } from "~/features/ecs/components/LogLine";
import { MIN_LOG_GUTTER, useAwsScope, useScope } from "~/contexts/ScopeContext";
import { hasAnsi, stripAnsi } from "~/lib/ansi";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pause, Play } from "lucide-react";
import { clockTime, fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";

/**
 * CloudWatch Logs for one container, scoped either to a single task or to
 * every task in the service.
 *
 * The container picker is always visible, even with one container, because
 * "which container am I reading?" is the question that makes ECS logs
 * confusing — a sidecar's output interleaved with the app's looks like the app
 * misbehaving.
 */
type LogOrder = "asc" | "desc";

/** Tail cadence when the app-wide refresh is set to manual. */
const TAIL_INTERVAL_MS = 10_000;

/**
 * The draggable edge of the timestamp column.
 *
 * Full timestamps are wider than clock times, and different sources want
 * different amounts of the line, so where the message starts is the reader's
 * choice. The strip runs the height of the scrolled content, so it can be
 * grabbed beside whatever line you happen to be reading, and the width it
 * writes is the app-wide setting rather than this pane's own state.
 */
function GutterHandle({ width, onResize }: { width: number; onResize: (next: number) => void }) {
  // The gutter sits inside the pane's p-3, and the strip straddles its edge.
  const left = width + 12 - 4;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the timestamp column"
      title="Drag to resize the timestamp column"
      style={{ left }}
      onPointerDown={(event) => {
        event.preventDefault();
        const start = event.clientX;
        const from = width;
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);

        const move = (moveEvent: PointerEvent) =>
          onResize(Math.max(MIN_LOG_GUTTER, from + (moveEvent.clientX - start)));
        const stop = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", stop);
          handle.removeEventListener("pointercancel", stop);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
      }}
      className="absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-transparent after:transition-colors hover:after:bg-primary/60"
    />
  );
}

export function LogsPane({
  taskDefinition,
  taskId = null,
  /** Shown in the header so it is obvious whose logs these are. */
  scopeLabel,
  /** Epoch ms bounds, for reading the window of one past deployment. */
  startTime,
  endTime,
}: {
  taskDefinition: string;
  taskId?: string | null;
  scopeLabel: string;
  startTime?: number | undefined;
  endTime?: number | undefined;
}) {
  const scope = useAwsScope();
  const { region, refreshSeconds, logTimestamps, logGutter, setLogGutter } = useScope();
  const [containerName, setContainerName] = React.useState<string | null>(null);
  // The pattern as CloudWatch will receive it; the filter bar owns the raw
  // text and the mode that produced this.
  const [appliedFilter, setAppliedFilter] = React.useState<string | null>(null);
  // A closed historical window can't gain lines, so tailing it would be a
  // spinner that never resolves into anything.
  const [tail, setTail] = React.useState(!endTime);
  const [order, setOrder] = React.useState<LogOrder>("asc");

  // Which task a line came from only matters while reading several at once,
  // and the column costs a fixed slice of every line's width. It lives in the
  // URL so the choice survives a reload and travels with a shared link.
  const navigate = useNavigate();
  const search: { stream?: "hidden" } = useSearch({ strict: false });
  const showStream = search.stream !== "hidden";
  const toggleStream = () =>
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        // The default is "shown", so that state is the absent param rather
        // than a second spelling of it. Everything else the URL carries -
        // which tab is open, above all - is passed through untouched.
        const { stream: _hidden, ...rest } = prev;
        return showStream ? { ...rest, stream: "hidden" } : rest;
      }) as never,
      // Hiding a column is adjusting the view, not a step in the trail.
      replace: true,
    });

  const configs = useQuery(trpc.ecs.logConfig.queryOptions({ ...scope, taskDefinition }));

  const active: ContainerLogConfig | null = React.useMemo(() => {
    const all = configs.data ?? [];
    if (all.length === 0) return null;
    return all.find((c) => c.containerName === containerName) ?? all[0] ?? null;
  }, [configs.data, containerName]);

  // ECS composes the stream as `<prefix>/<container>/<task id>`. Without a
  // task we prefix-match the container's streams across every running task.
  const logStream = React.useMemo(() => {
    if (!active?.streamPrefix) return null;
    const base = `${active.streamPrefix}/${active.containerName}`;
    return taskId ? `${base}/${taskId}` : base;
  }, [active, taskId]);

  const logs = useQuery({
    ...trpc.ecs.logs.queryOptions({
      ...scope,
      logGroup: active?.logGroup ?? "",
      ...(logStream ? { logStreamPrefix: logStream } : {}),
      ...(appliedFilter ? { filterPattern: appliedFilter } : {}),
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      limit: 500,
    }),
    enabled: Boolean(active?.logGroup),
    // Tailing owns the polling here: the app-wide interval is the floor, and a
    // session left on manual still gets a live tail rather than a frozen one.
    ...(tail && !endTime
      ? { refetchInterval: refreshSeconds > 0 ? refreshSeconds * 1000 : TAIL_INTERVAL_MS }
      : {}),
  });

  const edgeRef = React.useRef<HTMLDivElement>(null);
  // Stable identity: `?? []` would hand every memo below a fresh array on each
  // render while the query has no data.
  const events = React.useMemo(() => logs.data?.events ?? [], [logs.data]);

  // CloudWatch returns oldest first; newest-first is a reversal rather than a
  // second query, so the sort costs nothing and never disagrees with the data.
  const ordered = React.useMemo(
    () => (order === "asc" ? events : events.toReversed()),
    [events, order],
  );

  React.useEffect(() => {
    // Only chase the newest line while tailing - otherwise scrolling up to read
    // something would be undone by the next poll.
    if (tail) edgeRef.current?.scrollIntoView({ block: order === "asc" ? "end" : "start" });
  }, [ordered, tail, order]);

  if (configs.isPending) return <LoadingRows rows={8} />;
  if (configs.isError) {
    return <ErrorState error={configs.error} onRetry={() => void configs.refetch()} />;
  }

  if (!active) {
    return <EmptyState icon={FileWarning} title="This task definition declares no containers" />;
  }

  const consoleUrl = active.logGroup
    ? `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encodeURIComponent(active.logGroup).replace(/%2F/g, "$252F")}`
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2">
        <Segmented
          value={active.containerName}
          onChange={setContainerName}
          options={(configs.data ?? []).map((config) => ({
            value: config.containerName,
            label: config.containerName,
          }))}
        />

        <Badge tone={taskId ? "primary" : "neutral"}>{taskId ? "this task" : "all tasks"}</Badge>
        {endTime ? <Badge tone="neutral">historical window</Badge> : null}
        <span className="font-mono text-[10.5px] text-muted-foreground">{scopeLabel}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant={tail ? "default" : "outline"}
            onClick={() => setTail((prev) => !prev)}
            disabled={Boolean(endTime)}
            title={
              endTime
                ? "This window has closed, so there is nothing to tail"
                : tail
                  ? "Stop following new lines"
                  : "Follow new lines as they arrive"
            }
          >
            {tail ? <Pause className="size-3" /> : <Play className="size-3" />}
            {tail ? "Tailing" : "Tail"}
          </Button>

          {!taskId ? (
            <Button
              type="button"
              variant="outline"
              onClick={toggleStream}
              title={
                showStream
                  ? "Hide the column showing which task each line came from"
                  : "Show which task each line came from"
              }
            >
              {showStream ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              {showStream ? "Hide task IDs" : "Show task IDs"}
            </Button>
          ) : null}

          <Button
            type="button"
            onClick={() => setOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
            title="Switch between oldest and newest first"
          >
            {order === "asc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
            {order === "asc" ? "Oldest" : "Newest"}
          </Button>

          <LogFilterBar onApply={setAppliedFilter} disabled={!active.logGroup} />
          <CopyButton
            variant="ghost"
            size="icon"
            label="log lines"
            // Escapes are for a terminal, not for whatever this is pasted into.
            value={() => events.map((e) => `${e.timestamp} ${stripAnsi(e.message)}`).join("\n")}
          />
          {consoleUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Open this log group in CloudWatch"
              title="Open this log group in CloudWatch"
              onClick={() => window.open(consoleUrl, "_blank", "noopener")}
            >
              <ExternalLink className="size-3" />
            </Button>
          ) : null}
        </div>
      </div>

      {!active.logGroup ? (
        <EmptyState
          icon={FileWarning}
          title={
            active.logDriver
              ? `"${active.containerName}" logs through ${active.logDriver}, not awslogs`
              : `"${active.containerName}" declares no log configuration`
          }
          hint="Only the awslogs driver can be read back through the ECS APIs. Check the destination that driver is configured with."
        />
      ) : logs.isPending ? (
        <LoadingRows rows={10} />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No log events in this window"
          hint={`Group ${active.logGroup}${logStream ? ` · stream ${logStream}` : ""}`}
        />
      ) : (
        <div className="relative min-h-0 flex-1 overflow-auto p-3 font-mono text-[11.5px] leading-relaxed">
          <GutterHandle width={logGutter} onResize={setLogGutter} />
          {order === "desc" ? <div ref={edgeRef} aria-hidden /> : null}
          {ordered.map((event) => (
            <div
              key={`${event.timestamp}-${event.stream}-${event.message}`}
              className="flex gap-2.5 whitespace-pre-wrap break-words"
            >
              <span
                style={{ width: logGutter }}
                className="shrink-0 truncate text-muted-foreground/60 tabular"
                title={fullTimestamp(event.timestamp)}
              >
                {logTimestamps === "full"
                  ? fullTimestamp(event.timestamp)
                  : clockTime(event.timestamp)}
              </span>
              {!taskId && showStream ? (
                <span
                  className="w-32 shrink-0 truncate text-muted-foreground/70"
                  title={event.stream}
                >
                  {event.stream.slice(event.stream.lastIndexOf("/") + 1)}
                </span>
              ) : null}
              <LogLine
                text={event.message}
                className={
                  // Only tint the line when the program didn't already colour
                  // it - overriding its own ANSI would throw away better
                  // information than this heuristic has.
                  !hasAnsi(event.message) && /error|exception|fatal/i.test(event.message)
                    ? "text-danger"
                    : undefined
                }
              />
            </div>
          ))}
          {order === "asc" ? <div ref={edgeRef} aria-hidden /> : null}
        </div>
      )}
    </div>
  );
}
