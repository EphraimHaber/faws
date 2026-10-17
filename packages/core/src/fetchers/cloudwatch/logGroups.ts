import {
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
  GetLogEventsCommand,
  type LogGroup as AwsLogGroup,
} from "@aws-sdk/client-cloudwatch-logs";
import type {
  AwsScope,
  LogEvent,
  LogEventWindow,
  LogGroup,
  LogGroupListing,
  LogStream,
} from "@faws/contracts";
import { toIso } from "@faws/shared";

import { callAws, logsClient, type Page } from "../../clients.ts";

/** DescribeLogGroups returns at most 50 a page; this many pages is 5,000 groups. */
const MAX_GROUP_PAGES = 100;

/** A group as the pages show it, or `null` for one without a name. */
export function logGroupEntry(group: AwsLogGroup): LogGroup | null {
  if (!group.logGroupName) return null;
  return {
    name: group.logGroupName,
    arn: group.logGroupArn ?? group.arn ?? null,
    createdAt: toIso(group.creationTime),
    retentionDays: group.retentionInDays ?? null,
    storedBytes: group.storedBytes ?? null,
    logClass: group.logGroupClass ?? null,
  };
}

/**
 * Every log group in the region, up to a cap.
 *
 * Collected rather than paged to the caller, because the list is filtered and
 * sorted as a whole on the page - a sort over the first fifty groups would be
 * a sort that lies.
 */
export async function listLogGroups(scope: AwsScope): Promise<LogGroupListing> {
  const client = logsClient(scope);
  const groups: LogGroup[] = [];
  let token: string | undefined;
  let pages = 0;
  do {
    const page = await callAws("logs", () =>
      client.send(
        new DescribeLogGroupsCommand({ limit: 50, ...(token ? { nextToken: token } : {}) }),
      ),
    );
    for (const group of page.logGroups ?? []) {
      const entry = logGroupEntry(group);
      if (entry) groups.push(entry);
    }
    token = page.nextToken;
    pages += 1;
  } while (token && pages < MAX_GROUP_PAGES);

  return { groups, truncated: Boolean(token) };
}

/** The group named exactly `name` among those a prefix search found, if any. */
export function exactLogGroup(groups: ReadonlyArray<AwsLogGroup>, name: string): LogGroup | null {
  const match = groups.find((group) => group.logGroupName === name);
  return match ? logGroupEntry(match) : null;
}

/**
 * One log group by its exact name, or `null` when the region has none.
 *
 * DescribeLogGroups only searches by prefix, and lists names in order, so a
 * group named exactly the prefix comes before every longer name sharing it
 * and one page is enough to find it.
 */
export async function describeLogGroup(scope: AwsScope, name: string): Promise<LogGroup | null> {
  const client = logsClient(scope);
  const page = await callAws("logs", () =>
    client.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: name, limit: 50 })),
  );
  return exactLogGroup(page.logGroups ?? [], name);
}

/** One page of a group's streams, the most recently written first. */
export async function listLogStreams(
  scope: AwsScope,
  logGroup: string,
  nextToken?: string,
): Promise<Page<LogStream>> {
  const client = logsClient(scope);
  const page = await callAws("logs", () =>
    client.send(
      new DescribeLogStreamsCommand({
        logGroupName: logGroup,
        orderBy: "LastEventTime",
        descending: true,
        limit: 50,
        ...(nextToken ? { nextToken } : {}),
      }),
    ),
  );
  return {
    items: (page.logStreams ?? []).flatMap((stream): LogStream[] =>
      stream.logStreamName
        ? [
            {
              name: stream.logStreamName,
              createdAt: toIso(stream.creationTime),
              firstEventAt: toIso(stream.firstEventTimestamp),
              lastEventAt: toIso(stream.lastEventTimestamp),
            },
          ]
        : [],
    ),
    nextToken: page.nextToken ?? null,
  };
}

export interface LogWindowQuery {
  readonly logGroup: string;
  /** One stream, or absent for every stream in the group. */
  readonly logStream?: string;
  /** How far back from now the window opens. */
  readonly windowMinutes: number;
  readonly filterPattern?: string;
  readonly limit?: number;
}

/**
 * FilterLogEvents pages through a window oldest first, and a page can come
 * back empty with more to follow, so a busy group is read this many pages at
 * most before the read gives up on reaching the end.
 */
const MAX_FILTER_PAGES = 20;

/**
 * The newest events in a window that ends now.
 *
 * The window is relative rather than a pair of timestamps so that re-running
 * the same query is a tail: each run reads up to the moment it runs.
 *
 * One stream without a filter reads backwards from the end with GetLogEvents,
 * which is the one API that can start at the newest line. Anything else goes
 * through FilterLogEvents, which only reads forwards - so its pages are walked
 * towards now, keeping the last `limit` lines, and a window too busy to walk
 * in `MAX_FILTER_PAGES` says so instead of passing its oldest part off as the
 * latest.
 */
export async function fetchLogWindow(
  scope: AwsScope,
  query: LogWindowQuery,
): Promise<LogEventWindow> {
  const client = logsClient(scope);
  const limit = query.limit ?? 500;
  const startTime = Date.now() - query.windowMinutes * 60_000;

  if (query.logStream && !query.filterPattern) {
    const stream = query.logStream;
    const page = await callAws("logs", () =>
      client.send(
        new GetLogEventsCommand({
          logGroupName: query.logGroup,
          logStreamName: stream,
          startTime,
          startFromHead: false,
          limit,
        }),
      ),
    );
    const events = (page.events ?? []).map((event): LogEvent => ({
      timestamp: toIso(event.timestamp) ?? "",
      message: event.message ?? "",
      stream,
    }));
    return { events, truncated: events.length >= limit ? "older" : null };
  }

  let kept: LogEvent[] = [];
  let dropped = false;
  let token: string | undefined;
  let pages = 0;
  do {
    const page = await callAws("logs", () =>
      client.send(
        new FilterLogEventsCommand({
          logGroupName: query.logGroup,
          ...(query.logStream ? { logStreamNames: [query.logStream] } : {}),
          startTime,
          ...(query.filterPattern ? { filterPattern: query.filterPattern } : {}),
          ...(token ? { nextToken: token } : {}),
        }),
      ),
    );
    for (const event of page.events ?? []) {
      kept.push({
        timestamp: toIso(event.timestamp) ?? "",
        message: event.message ?? "",
        stream: event.logStreamName ?? "-",
      });
    }
    if (kept.length > limit) {
      kept = kept.slice(-limit);
      dropped = true;
    }
    token = page.nextToken;
    pages += 1;
  } while (token && pages < MAX_FILTER_PAGES);

  return { events: kept, truncated: token ? "newer" : dropped ? "older" : null };
}
