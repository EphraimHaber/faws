import { GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import type { MetricSeries, S3Scope } from "@faws/contracts";
import { AwsRequestError } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { callAws, cloudWatchClient } from "../../clients.ts";
import { connectionFor } from "../../s3/connections.ts";
import { bucketRegion } from "./buckets.ts";

/** A day, which is the shortest period these are published at. */
const PERIOD_SECONDS = 86_400;

/**
 * How big the bucket is, from CloudWatch rather than by counting.
 *
 * Walking a bucket to total it costs a request per thousand keys; these are
 * published daily for free. The catch is that they are daily: this answers
 * "how has it grown" rather than "what is in it right now".
 */
export async function bucketStorageMetrics(
  scope: S3Scope,
  bucket: string,
  options: { days?: number } = {},
): Promise<MetricSeries[]> {
  // These come from CloudWatch, which an S3 compatible endpoint has no
  // counterpart to; asking AWS about a bucket it does not have would answer
  // with an empty series that reads like a bucket of nothing.
  if (await connectionFor(scope)) {
    throw new AwsRequestError("This endpoint does not publish storage metrics.", {
      code: "NotImplemented",
      service: "s3",
    });
  }

  // The metrics live in the bucket's own region, not the one in scope.
  const region = await bucketRegion(scope, bucket);
  const client = cloudWatchClient({ profile: scope.profile, region });

  const days = options.days ?? 30;
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

  // `BucketSizeBytes` is published per storage type and has no total, so the
  // standard tier is asked for by name; `NumberOfObjects` uses its own.
  const wanted = [
    { metric: "BucketSizeBytes", storageType: "StandardStorage" },
    { metric: "NumberOfObjects", storageType: "AllStorageTypes" },
  ] as const;

  return Promise.all(
    wanted.map(async ({ metric, storageType }): Promise<MetricSeries> => {
      const page = await callAws("cloudwatch", () =>
        client.send(
          new GetMetricStatisticsCommand({
            Namespace: "AWS/S3",
            MetricName: metric,
            Dimensions: [
              { Name: "BucketName", Value: bucket },
              { Name: "StorageType", Value: storageType },
            ],
            StartTime: startTime,
            EndTime: endTime,
            Period: PERIOD_SECONDS,
            Statistics: ["Average", "Maximum"],
          }),
        ),
      );

      const points = (page.Datapoints ?? [])
        .map((point) => ({
          timestamp: toIso(point.Timestamp) ?? "",
          average: point.Average ?? null,
          maximum: point.Maximum ?? null,
        }))
        .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));

      return { metric, points };
    }),
  );
}
