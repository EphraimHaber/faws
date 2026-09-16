import { FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import type { AwsScope, ContainerLogConfig, LogEvent } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { callAws, logsClient } from "../../clients.ts";

export interface LogQuery {
  readonly logGroup: string;
  readonly logStreamPrefix?: string;
  readonly startTime?: number;
  /** Upper bound, for reading the window of a deployment that has finished. */
  readonly endTime?: number;
  readonly filterPattern?: string;
  readonly limit?: number;
}

/**
 * One page of CloudWatch Logs for the log pane. Live tailing sits on top of
 * this: the socket handler re-runs the query with `startTime` advanced past
 * the newest event it has already delivered.
 */
export async function fetchLogEvents(
  scope: AwsScope,
  query: LogQuery,
): Promise<{ events: LogEvent[]; latestTimestamp: number | null }> {
  const client = logsClient(scope);
  const page = await callAws("logs", () =>
    client.send(
      new FilterLogEventsCommand({
        logGroupName: query.logGroup,
        ...(query.logStreamPrefix ? { logStreamNamePrefix: query.logStreamPrefix } : {}),
        ...(query.startTime ? { startTime: query.startTime } : {}),
        ...(query.endTime ? { endTime: query.endTime } : {}),
        ...(query.filterPattern ? { filterPattern: query.filterPattern } : {}),
        limit: query.limit ?? 200,
      }),
    ),
  );

  let latest: number | null = null;
  const events = (page.events ?? []).map((event): LogEvent => {
    if (event.timestamp !== undefined && (latest === null || event.timestamp > latest)) {
      latest = event.timestamp;
    }
    return {
      timestamp: toIso(event.timestamp) ?? "",
      message: event.message ?? "",
      stream: event.logStreamName ?? "-",
    };
  });

  return { events, latestTimestamp: latest };
}

interface ContainerDefinitionLike {
  readonly name?: string | undefined;
  readonly logConfiguration?:
    | { logDriver?: string | undefined; options?: Record<string, string> | undefined }
    | undefined;
}

/**
 * Reads the log wiring off each container definition.
 *
 * Only `awslogs` yields a group we can query; every other driver still gets an
 * entry so the UI can name the driver rather than showing an unexplained empty
 * pane.
 */
export function containerLogConfigs(
  containerDefinitions: ReadonlyArray<ContainerDefinitionLike>,
): ContainerLogConfig[] {
  return containerDefinitions.map((definition): ContainerLogConfig => {
    const config = definition.logConfiguration;
    const isAwslogs = config?.logDriver === "awslogs";
    return {
      containerName: definition.name ?? "-",
      logDriver: config?.logDriver ?? null,
      logGroup: isAwslogs ? (config?.options?.["awslogs-group"] ?? null) : null,
      streamPrefix: isAwslogs ? (config?.options?.["awslogs-stream-prefix"] ?? null) : null,
      region: isAwslogs ? (config?.options?.["awslogs-region"] ?? null) : null,
    };
  });
}

/**
 * The CloudWatch stream one container of one task writes to. ECS composes it
 * as `<prefix>/<container>/<task id>`; without a prefix the caller has to fall
 * back to filtering the whole group.
 */
export function logStreamFor(config: ContainerLogConfig, taskId: string | null): string | null {
  if (!config.streamPrefix) return null;
  const base = `${config.streamPrefix}/${config.containerName}`;
  return taskId ? `${base}/${taskId}` : base;
}
