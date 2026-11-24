/**
 * S3 as AWS's object storage.
 *
 * A connection is a profile and region (`profile@region`). Buckets are listed
 * account wide and addressed in their own region, so a call about one bucket
 * gets a client in that bucket's region, and its daily size comes from
 * CloudWatch there.
 */
import { AwsRequestError, awsScopeOf, type AwsScope } from "@faws/contracts";
import { bucketRegion, bucketStorageMetrics, s3Client, s3ClientForBucket } from "@faws/core";
import type { ConnectionRef } from "@faws/kit";
import { registerObjectStorage } from "@faws/kit/server";
import { createS3ObjectStoragePort } from "@faws/lib-s3";

function scopeOf(ref: ConnectionRef): AwsScope {
  const scope = awsScopeOf(ref);
  if (!scope) {
    throw new AwsRequestError(`"${ref.id}" is not an AWS profile and region.`, {
      code: "BadConnection",
      service: "s3",
    });
  }
  return scope;
}

export const awsObjectStorage = createS3ObjectStoragePort(
  async (ref, bucket) =>
    bucket === undefined ? s3Client(scopeOf(ref)) : s3ClientForBucket(scopeOf(ref), bucket),
  {
    features: () => Promise.resolve({ bucketRegions: true, storageMetrics: true, presign: true }),
    bucketRegion: (ref, bucket) => bucketRegion(scopeOf(ref), bucket),
    storageMetrics: async (ref, bucket, days) => {
      const scope = scopeOf(ref);
      return bucketStorageMetrics(scope.profile, await bucketRegion(scope, bucket), bucket, {
        days,
      });
    },
  },
);

export function registerAwsObjectStorage(): void {
  registerObjectStorage("aws", awsObjectStorage);
}
