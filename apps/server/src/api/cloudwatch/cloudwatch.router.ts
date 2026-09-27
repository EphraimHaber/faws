/**
 * Read-only CloudWatch surface: log groups, their streams and events, and any
 * metric the account publishes.
 *
 * The ECS router reads the same two services for one service's containers;
 * this is the view that is not tied to anything, for the log groups and
 * metrics that no other page reaches.
 */
import { CLOUDWATCH_WINDOWS } from "@faws/contracts";
import {
  fetchLogWindow,
  listLogGroups,
  listLogStreams,
  listMetricsPage,
  metricSeries,
} from "@faws/core";
import { z } from "zod";

import { guard, publicProcedure, router, scopeInput } from "../../trpc/index.ts";

const windowInput = z.literal(CLOUDWATCH_WINDOWS);

const logGroupInput = scopeInput.extend({ logGroup: z.string().min(1).max(512) });

export const cloudwatchRouter = router({
  logGroups: publicProcedure
    .input(scopeInput)
    .query(({ input }) => guard(() => listLogGroups(input))),

  logStreams: publicProcedure
    .input(logGroupInput.extend({ cursor: z.string().nullish() }))
    .query(({ input }) =>
      guard(() => listLogStreams(input, input.logGroup, input.cursor ?? undefined)),
    ),

  logEvents: publicProcedure
    .input(
      logGroupInput.extend({
        logStream: z.string().min(1).max(512).optional(),
        windowMinutes: windowInput,
        filterPattern: z.string().max(1024).optional(),
        limit: z.number().int().positive().max(2000).optional(),
      }),
    )
    .query(({ input }) =>
      guard(() =>
        fetchLogWindow(input, {
          logGroup: input.logGroup,
          windowMinutes: input.windowMinutes,
          ...(input.logStream ? { logStream: input.logStream } : {}),
          ...(input.filterPattern ? { filterPattern: input.filterPattern } : {}),
          ...(input.limit ? { limit: input.limit } : {}),
        }),
      ),
    ),

  /**
   * One page of metrics, narrowed by the table's filter on the server. Shaped
   * for an infinite query: `cursor` in, `nextToken` out.
   */
  metrics: publicProcedure
    .input(
      scopeInput.extend({
        namespace: z.string().min(1).max(255).optional(),
        query: z.string().max(200).optional(),
        cursor: z.string().nullish(),
      }),
    )
    .query(({ input }) =>
      guard(() =>
        listMetricsPage(input, {
          ...(input.namespace ? { namespace: input.namespace } : {}),
          ...(input.query ? { query: input.query } : {}),
          ...(input.cursor ? { cursor: input.cursor } : {}),
        }),
      ),
    ),

  metricSeries: publicProcedure
    .input(
      scopeInput.extend({
        namespace: z.string().min(1).max(255),
        metricName: z.string().min(1).max(255),
        // CloudWatch allows 30 dimensions on a metric.
        dimensions: z
          .array(z.object({ name: z.string().min(1).max(255), value: z.string().max(1024) }))
          .max(30),
        windowMinutes: windowInput,
      }),
    )
    .query(({ input }) =>
      guard(() =>
        metricSeries(input, {
          namespace: input.namespace,
          metricName: input.metricName,
          dimensions: input.dimensions,
          windowMinutes: input.windowMinutes,
        }),
      ),
    ),
});
