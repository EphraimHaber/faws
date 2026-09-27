import {
  CLOUDWATCH_WINDOWS,
  type CloudWatchWindow,
  DEFAULT_CLOUDWATCH_WINDOW,
  type LogStream,
  windowLabel,
} from "@faws/contracts";
import { byteSize, relativeTime } from "@faws/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ExternalLink,
  FileWarning,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  X,
} from "lucide-react";
import * as React from "react";

import { PinButton } from "~/components/PinButton";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import {
  LogLines,
  type LogOrder,
  LogViewControls,
  TAIL_INTERVAL_MS,
  useFollowNewest,
  useShownSearch,
} from "~/features/cloudwatch/components/LogLines";
import { TruncatedNote, WindowPicker } from "~/features/cloudwatch/components/LogWindow";
import { retentionLabel } from "~/features/cloudwatch/metric-ref";
import { logGroupRef } from "~/features/cloudwatch/refs";
import { LogFilterBar } from "~/features/ecs/components/LogFilterBar";
import { useSearchState } from "~/hooks/useSearchState";
import { stripAnsi } from "~/lib/ansi";
import { fullTimestamp } from "~/lib/format";
import { trpc } from "~/lib/trpc";
import { useRecordVisit } from "~/stores/recents";
import { cn } from "~/lib/utils";

/**
 * One log group: its streams down the side, and a tail of what it holds.
 *
 * Which stream and which window are open ride in the URL, so a link lands on
 * the same lines, and so do the stream list and the stream column being
 * hidden. The filter does not: every apply is a billed query, and a link that
 * ran one on arrival would be a surprise on someone else's bill.
 */
export function LogGroupPage({ group }: { group: string }) {
  const scope = useAwsScope();
  const navigate = useNavigate();
  const { region, refreshSeconds } = useScope();
  const target = React.useMemo(() => logGroupRef(group, scope), [group, scope]);
  useRecordVisit(target);

  const [stream, setStream] = useSearchState<string>({
    key: "logStream",
    fallback: "",
    parse: (raw) => (typeof raw === "string" ? raw : ""),
  });
  const [windowMinutes, setWindowMinutes] = useSearchState<CloudWatchWindow>({
    key: "window",
    fallback: DEFAULT_CLOUDWATCH_WINDOW,
    parse: (raw) =>
      CLOUDWATCH_WINDOWS.find((minutes) => minutes === Number(raw)) ?? DEFAULT_CLOUDWATCH_WINDOW,
  });
  const [showStreamList, toggleStreamList] = useShownSearch("streams");
  const [showStreamColumn, toggleStreamColumn] = useShownSearch("stream");
  const [appliedFilter, setAppliedFilter] = React.useState<string | null>(null);
  const [tail, setTail] = React.useState(true);
  const [order, setOrder] = React.useState<LogOrder>("asc");

  const groups = useQuery(trpc.cloudwatch.logGroups.queryOptions(scope));
  const detail = groups.data?.groups.find((entry) => entry.name === group) ?? null;

  const logs = useQuery({
    ...trpc.cloudwatch.logEvents.queryOptions({
      ...scope,
      logGroup: group,
      windowMinutes,
      ...(stream ? { logStream: stream } : {}),
      ...(appliedFilter ? { filterPattern: appliedFilter } : {}),
      limit: 500,
    }),
    // Tailing owns the polling here, as it does on the ECS log pane: the
    // app-wide interval is the floor, and manual still gets a live tail.
    ...(tail
      ? { refetchInterval: refreshSeconds > 0 ? refreshSeconds * 1000 : TAIL_INTERVAL_MS }
      : {}),
  });

  const events = React.useMemo(() => logs.data?.events ?? [], [logs.data]);
  const ordered = React.useMemo(
    () => (order === "asc" ? events : events.toReversed()),
    [events, order],
  );

  const bodyRef = React.useRef<HTMLDivElement>(null);
  useFollowNewest(bodyRef, ordered, tail, order);

  const consoleUrl = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${encodeURIComponent(group).replace(/%2F/g, "$252F")}`;

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggleStreamList}
          aria-pressed={showStreamList}
          aria-label={showStreamList ? "Hide the stream list" : "Show the stream list"}
          title={showStreamList ? "Hide the stream list" : "Show the stream list"}
        >
          {showStreamList ? (
            <PanelLeftClose className="size-3.5" />
          ) : (
            <PanelLeftOpen className="size-3.5" />
          )}
        </Button>
        <PanelTitle className="truncate">{group}</PanelTitle>
        <CopyButton variant="ghost" size="icon" label="log group name" value={group} />
        <PinButton target={target} />
        {detail ? (
          <>
            <Badge tone={detail.retentionDays === null ? "warning" : "neutral"}>
              {retentionLabel(detail.retentionDays)}
            </Badge>
            {detail.storedBytes !== null ? (
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {byteSize(detail.storedBytes)} stored
              </span>
            ) : null}
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            title="Tail this group alongside others"
            onClick={() =>
              void navigate({
                to: "/cloudwatch/tail",
                search: { groups: [group], window: windowMinutes },
              })
            }
          >
            <Layers className="size-3" />
            Tail with others
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Open this log group in CloudWatch"
            title="Open this log group in CloudWatch"
            onClick={() => void window.open(consoleUrl, "_blank", "noopener")}
          >
            <ExternalLink className="size-3" />
          </Button>
        </div>
      </PanelHeader>

      <div className="flex min-h-0 flex-1">
        {showStreamList ? (
          <StreamList group={group} selected={stream} onSelect={setStream} />
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2">
            <WindowPicker value={windowMinutes} onChange={setWindowMinutes} />
            {stream ? (
              // With the list hidden this is the only sign a stream is picked,
              // so it is also the way back to all of them.
              <Badge tone="primary" className="max-w-64 normal-case">
                <span className="truncate" title={stream}>
                  {stream}
                </span>
                <button
                  type="button"
                  onClick={() => setStream("")}
                  aria-label="Read every stream"
                  title="Read every stream"
                  className="cursor-pointer hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ) : (
              <Badge tone="neutral">all streams</Badge>
            )}
            {logs.isFetching ? <Spinner /> : null}

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <LogViewControls
                tail={tail}
                onToggleTail={() => setTail((prev) => !prev)}
                // One stream is one value in that column, so there is nothing
                // to show or hide.
                {...(stream
                  ? {}
                  : { showStream: showStreamColumn, onToggleStream: toggleStreamColumn })}
                order={order}
                onToggleOrder={() => setOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
              />
              <LogFilterBar onApply={setAppliedFilter} />
              <CopyButton
                variant="ghost"
                size="icon"
                label="log lines"
                value={() =>
                  events.map((event) => `${event.timestamp} ${stripAnsi(event.message)}`).join("\n")
                }
              />
            </div>
          </div>

          {logs.data?.truncated ? (
            <TruncatedNote
              truncated={logs.data.truncated}
              count={events.length}
              windowMinutes={windowMinutes}
            />
          ) : null}

          {logs.isPending ? (
            <LoadingRows rows={10} />
          ) : logs.isError ? (
            <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
          ) : events.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title={`No log events in the last ${windowLabel(windowMinutes)}`}
              hint={stream ? `Stream ${stream}` : "A longer window may reach something."}
            />
          ) : (
            <LogLines lines={ordered} showStream={!stream && showStreamColumn} bodyRef={bodyRef} />
          )}
        </div>
      </div>
    </Panel>
  );
}

/**
 * The group's streams, most recently written first, with "every stream" at
 * the top. Paged, because a group written by short-lived tasks can hold more
 * streams than anyone will scroll through.
 */
function StreamList({
  group,
  selected,
  onSelect,
}: {
  group: string;
  selected: string;
  onSelect: (stream: string) => void;
}) {
  const scope = useAwsScope();
  const streams = useInfiniteQuery({
    ...trpc.cloudwatch.logStreams.infiniteQueryOptions(
      { ...scope, logGroup: group },
      { getNextPageParam: (last) => last.nextToken },
    ),
    staleTime: 30_000,
  });
  const rows: LogStream[] = streams.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <nav
      aria-label="Log streams"
      className="flex w-52 shrink-0 flex-col overflow-auto border-r border-border lg:w-72"
    >
      <StreamRow
        active={selected === ""}
        onClick={() => onSelect("")}
        label="All streams"
        detail={streams.isPending ? "…" : `${rows.length}${streams.hasNextPage ? "+" : ""}`}
      />
      {streams.isPending ? (
        <LoadingRows rows={6} />
      ) : streams.isError ? (
        <ErrorState error={streams.error} onRetry={() => void streams.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={FileWarning} title="No streams" />
      ) : (
        rows.map((stream) => (
          <StreamRow
            key={stream.name}
            active={selected === stream.name}
            onClick={() => onSelect(stream.name)}
            label={stream.name}
            detail={relativeTime(stream.lastEventAt)}
            title={`Last event ${fullTimestamp(stream.lastEventAt)}`}
          />
        ))
      )}
      {streams.hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          className="m-2"
          disabled={streams.isFetchingNextPage}
          onClick={() => void streams.fetchNextPage()}
        >
          {streams.isFetchingNextPage ? <Spinner /> : null}
          More streams
        </Button>
      ) : null}
    </nav>
  );
}

function StreamRow({
  active,
  onClick,
  label,
  detail,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  detail: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex cursor-pointer items-baseline gap-2 border-b border-border/50 px-3 py-1.5 text-left text-[12px] transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{label}</span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular">
        {detail}
      </span>
    </button>
  );
}
