import {
  CLOUDWATCH_WINDOWS,
  type CloudWatchWindow,
  DEFAULT_CLOUDWATCH_WINDOW,
  type LogEventWindow,
  type LogGroup,
  MAX_TAILED_GROUPS,
  windowLabel,
} from "@faws/contracts";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AlertTriangle, Eye, EyeOff, Plus, ScrollText, X } from "lucide-react";
import * as React from "react";

import { Dialog } from "~/components/Dialog";
import { ResourcePicker } from "~/components/ResourcePicker";
import { Segmented } from "~/components/segmented";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import {
  groupTail,
  groupToneAt,
  LogLines,
  type LogOrder,
  LogViewControls,
  type ShownEvent,
  TAIL_INTERVAL_MS,
  useFollowNewest,
  useShownSearch,
} from "~/features/cloudwatch/components/LogLines";
import { TruncatedNote, WindowPicker } from "~/features/cloudwatch/components/LogWindow";
import { LogFilterBar } from "~/features/ecs/components/LogFilterBar";
import { useSearchState } from "~/hooks/useSearchState";
import { stripAnsi } from "~/lib/ansi";
import { trpc } from "~/lib/trpc";
import { cn } from "~/lib/utils";

/** The interleaved view shows at most this many lines, the newest. */
const MAX_MERGED_LINES = 2000;

type Layout = "merged" | "split";

/** What the page needs of one group's query. */
interface GroupResult {
  readonly data: LogEventWindow | undefined;
  readonly error: unknown;
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly refetch: () => unknown;
}

/**
 * Module level so its identity is stable: `useQueries` only re-runs a combine
 * whose reference or inputs changed, which is what keeps the merge below from
 * running on every render.
 */
function combineResults(results: ReadonlyArray<GroupResult>): ReadonlyArray<GroupResult> {
  return results.map((result) => ({
    data: result.data,
    error: result.error,
    isError: result.isError,
    isPending: result.isPending,
    isFetching: result.isFetching,
    refetch: result.refetch,
  }));
}

/**
 * Several log groups tailed at once.
 *
 * Each group is its own query, polled in parallel, so one group the profile
 * cannot read or one that is slow to answer costs only itself - its chip says
 * what went wrong while the rest keep arriving. The lines are either
 * interleaved by time, with a coloured column naming the group, or laid out
 * side by side, one column per group.
 *
 * The groups, the window, the layout and the stream column ride in the URL, so
 * a tail is a link. Muting a group is a glance, not a view, so it does not.
 */
export function TailPage() {
  const scope = useAwsScope();
  const navigate = useNavigate();
  const { refreshSeconds } = useScope();
  const search: { groups?: string[] } = useSearch({ strict: false });
  const groups = React.useMemo(() => search.groups ?? [], [search.groups]);
  const setGroups = (next: ReadonlyArray<string>) =>
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        const { groups: _groups, ...rest } = prev;
        return next.length > 0 ? { ...rest, groups: [...next] } : rest;
      }) as never,
      replace: true,
    });

  const [windowMinutes, setWindowMinutes] = useSearchState<CloudWatchWindow>({
    key: "window",
    fallback: DEFAULT_CLOUDWATCH_WINDOW,
    parse: (raw) =>
      CLOUDWATCH_WINDOWS.find((minutes) => minutes === Number(raw)) ?? DEFAULT_CLOUDWATCH_WINDOW,
  });
  const [layout, setLayout] = useSearchState<Layout>({
    key: "layout",
    fallback: "merged",
    parse: (raw) => (raw === "split" ? "split" : "merged"),
  });
  const [showStream, toggleStream] = useShownSearch("stream");
  const [muted, setMuted] = React.useState<ReadonlySet<string>>(new Set());
  const [appliedFilter, setAppliedFilter] = React.useState<string | null>(null);
  const [tail, setTail] = React.useState(true);
  const [order, setOrder] = React.useState<LogOrder>("asc");
  const [adding, setAdding] = React.useState(false);

  const results = useQueries({
    queries: groups.map((group) => ({
      ...trpc.cloudwatch.logEvents.queryOptions({
        ...scope,
        logGroup: group,
        windowMinutes,
        ...(appliedFilter ? { filterPattern: appliedFilter } : {}),
        limit: 500,
      }),
      ...(tail
        ? { refetchInterval: refreshSeconds > 0 ? refreshSeconds * 1000 : TAIL_INTERVAL_MS }
        : {}),
    })),
    combine: combineResults,
  });

  const tone = React.useCallback(
    (group: string) => groupToneAt(Math.max(0, groups.indexOf(group))),
    [groups],
  );

  const merged = React.useMemo(() => {
    const lines: ShownEvent[] = [];
    groups.forEach((group, index) => {
      if (muted.has(group)) return;
      for (const event of results[index]?.data?.events ?? []) lines.push({ ...event, group });
    });
    // ISO timestamps sort as text. Stable, so lines one group wrote in the
    // same millisecond keep the order that group wrote them in.
    const sorted = lines.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
    const newest = sorted.slice(-MAX_MERGED_LINES);
    return order === "asc" ? newest : newest.toReversed();
  }, [groups, muted, results, order]);

  const bodyRef = React.useRef<HTMLDivElement>(null);
  useFollowNewest(bodyRef, merged, tail && layout === "merged", order);

  const anyFetching = results.some((result) => result.isFetching);
  const visible = groups.filter((group) => !muted.has(group));

  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>Tail</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {groups.length} / {MAX_TAILED_GROUPS} groups
        </span>
        {anyFetching ? <Spinner /> : null}
        <div className="ml-auto flex items-center gap-2">
          <Segmented<Layout>
            value={layout}
            onChange={setLayout}
            options={[
              { value: "merged", label: "Interleaved" },
              { value: "split", label: "Side by side" },
            ]}
          />
          <Button
            type="button"
            variant="outline"
            disabled={groups.length >= MAX_TAILED_GROUPS}
            title={
              groups.length >= MAX_TAILED_GROUPS
                ? `At most ${MAX_TAILED_GROUPS} groups are tailed at once`
                : "Add a log group to this tail"
            }
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3" />
            Add group
          </Button>
        </div>
      </PanelHeader>

      {groups.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No log groups in this tail"
          hint="Add one here, or tick several on the log groups list and tail them together."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3.5 py-2">
            {groups.map((group, index) => (
              <GroupChip
                key={group}
                group={group}
                tone={groupToneAt(index)}
                result={results[index]}
                muted={muted.has(group)}
                onToggleMuted={() =>
                  setMuted((prev) => {
                    const next = new Set(prev);
                    if (next.has(group)) next.delete(group);
                    else next.add(group);
                    return next;
                  })
                }
                onRemove={() => setGroups(groups.filter((entry) => entry !== group))}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2">
            <WindowPicker value={windowMinutes} onChange={setWindowMinutes} />
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <LogViewControls
                tail={tail}
                onToggleTail={() => setTail((prev) => !prev)}
                showStream={showStream}
                onToggleStream={toggleStream}
                order={order}
                onToggleOrder={() => setOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
              />
              <LogFilterBar onApply={setAppliedFilter} />
              <CopyButton
                variant="ghost"
                size="icon"
                label="log lines"
                value={() =>
                  merged
                    .map(
                      (event) =>
                        `${event.timestamp} ${event.group ?? ""} ${stripAnsi(event.message)}`,
                    )
                    .join("\n")
                }
              />
            </div>
          </div>

          {layout === "merged" ? (
            <MergedBody
              results={results}
              groups={groups}
              visible={visible}
              lines={merged}
              windowMinutes={windowMinutes}
              showStream={showStream}
              tone={tone}
              bodyRef={bodyRef}
            />
          ) : (
            <div className="flex min-h-0 flex-1 overflow-x-auto">
              {groups.map((group, index) =>
                muted.has(group) ? null : (
                  <GroupColumn
                    key={group}
                    group={group}
                    tone={groupToneAt(index)}
                    result={results[index]}
                    windowMinutes={windowMinutes}
                    showStream={showStream}
                    tail={tail}
                    order={order}
                  />
                ),
              )}
            </div>
          )}
        </>
      )}

      {adding ? (
        <AddGroupDialog
          taken={groups}
          onAdd={(group) => {
            const next = [...groups, group];
            setGroups(next);
            if (next.length >= MAX_TAILED_GROUPS) setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Panel>
  );
}

/** One tailed group: its colour, its state, and the ways to mute or drop it. */
function GroupChip({
  group,
  tone,
  result,
  muted,
  onToggleMuted,
  onRemove,
}: {
  group: string;
  tone: string;
  result: GroupResult | undefined;
  muted: boolean;
  onToggleMuted: () => void;
  onRemove: () => void;
}) {
  const count = result?.data?.events.length;
  const problem = result?.isError
    ? result.error instanceof Error
      ? result.error.message
      : "This group could not be read"
    : result?.data?.truncated
      ? result.data.truncated === "older"
        ? "Only the newest lines in this window"
        : "The window is too busy to read to the end; these are its oldest lines"
      : null;

  return (
    <span
      className={cn(
        "flex max-w-80 items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 text-[11.5px]",
        muted && "opacity-50",
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-full bg-current", tone)} aria-hidden />
      <Link
        to="/cloudwatch/log-groups/$group"
        params={{ group }}
        className="truncate font-mono hover:underline"
        title={`Open ${group}`}
      >
        {groupTail(group)}
      </Link>
      {result?.isPending ? (
        <Spinner className="size-3" />
      ) : (
        <span className="font-mono text-[10px] text-muted-foreground tabular">{count ?? "-"}</span>
      )}
      {problem ? (
        <span title={problem} className={result?.isError ? "text-danger" : "text-warning"}>
          <AlertTriangle className="size-3" />
        </span>
      ) : null}
      <button
        type="button"
        onClick={onToggleMuted}
        aria-label={muted ? `Show ${group}` : `Hide ${group}`}
        title={muted ? "Show this group's lines" : "Hide this group's lines"}
        className="cursor-pointer text-muted-foreground hover:text-foreground"
      >
        {muted ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Stop tailing ${group}`}
        title="Stop tailing this group"
        className="cursor-pointer text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** Every visible group's lines on one timeline. */
function MergedBody({
  results,
  groups,
  visible,
  lines,
  windowMinutes,
  showStream,
  tone,
  bodyRef,
}: {
  results: ReadonlyArray<GroupResult>;
  groups: ReadonlyArray<string>;
  visible: ReadonlyArray<string>;
  lines: ReadonlyArray<ShownEvent>;
  windowMinutes: CloudWatchWindow;
  showStream: boolean;
  tone: (group: string) => string;
  bodyRef: React.RefObject<HTMLDivElement | null>;
}) {
  const shown = groups.flatMap((group, index) =>
    visible.includes(group) ? [{ group, result: results[index] }] : [],
  );

  if (shown.length > 0 && shown.every(({ result }) => result?.isPending)) {
    return <LoadingRows rows={10} />;
  }

  return (
    <>
      {shown.map(({ group, result }) =>
        result?.data?.truncated ? (
          <TruncatedNote
            key={group}
            group={groupTail(group)}
            truncated={result.data.truncated}
            count={result.data.events.length}
            windowMinutes={windowMinutes}
          />
        ) : null,
      )}
      {lines.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={
            shown.length === 0
              ? "Every group here is hidden"
              : `No log events in the last ${windowLabel(windowMinutes)}`
          }
          hint={
            shown.length === 0
              ? "Show one from its chip above."
              : "A longer window may reach something."
          }
        />
      ) : (
        <LogLines lines={lines} showStream={showStream} groupTone={tone} bodyRef={bodyRef} />
      )}
    </>
  );
}

/** One group's lines in a column of their own, for the side-by-side layout. */
function GroupColumn({
  group,
  tone,
  result,
  windowMinutes,
  showStream,
  tail,
  order,
}: {
  group: string;
  tone: string;
  result: GroupResult | undefined;
  windowMinutes: CloudWatchWindow;
  showStream: boolean;
  tail: boolean;
  order: LogOrder;
}) {
  const lines = React.useMemo(() => {
    const events = result?.data?.events ?? [];
    return order === "asc" ? events : events.toReversed();
  }, [result?.data, order]);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  useFollowNewest(bodyRef, lines, tail, order);

  return (
    <section
      aria-label={group}
      className="flex min-h-0 min-w-96 flex-1 flex-col border-r border-border last:border-r-0"
    >
      <header className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
        <span className={cn("size-2 shrink-0 rounded-full bg-current", tone)} aria-hidden />
        <span className="truncate font-mono text-[11.5px]" title={group}>
          {group}
        </span>
      </header>
      {result?.data?.truncated ? (
        <TruncatedNote
          truncated={result.data.truncated}
          count={result.data.events.length}
          windowMinutes={windowMinutes}
        />
      ) : null}
      {!result || result.isPending ? (
        <LoadingRows rows={8} />
      ) : result.isError ? (
        <ErrorState error={result.error} onRetry={() => void result.refetch()} />
      ) : lines.length === 0 ? (
        <EmptyState icon={ScrollText} title={`Nothing in the last ${windowLabel(windowMinutes)}`} />
      ) : (
        <LogLines lines={lines} showStream={showStream} bodyRef={bodyRef} compact />
      )}
    </section>
  );
}

function logGroupText(group: LogGroup): ReadonlyArray<string> {
  return [group.name];
}

/** Picks another group to tail, from the ones not in the tail already. */
function AddGroupDialog({
  taken,
  onAdd,
  onClose,
}: {
  taken: ReadonlyArray<string>;
  onAdd: (group: string) => void;
  onClose: () => void;
}) {
  const scope = useAwsScope();
  const groups = useQuery(trpc.cloudwatch.logGroups.queryOptions(scope));
  const items = React.useMemo(
    () => (groups.data?.groups ?? []).filter((group) => !taken.includes(group.name)),
    [groups.data, taken],
  );

  return (
    <Dialog id="cloudwatch-add-tail-group" title="Add a log group to the tail" onClose={onClose}>
      {groups.isError ? (
        <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
      ) : (
        <ResourcePicker
          items={items}
          pending={groups.isPending}
          keyOf={(group) => group.name}
          text={logGroupText}
          placeholder="Filter log groups"
          pendingLabel="Listing log groups..."
          emptyLabel="No log groups match."
          className="max-h-[22rem]"
        >
          {(group) => (
            <button
              type="button"
              onClick={() => onAdd(group.name)}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] hover:bg-accent"
            >
              <Plus className="size-3 text-muted-foreground" />
              <span className="truncate">{group.name}</span>
            </button>
          )}
        </ResourcePicker>
      )}
    </Dialog>
  );
}
