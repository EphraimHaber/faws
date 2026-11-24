/**
 * Which region an AWS bucket answers in, and a client pointed there.
 *
 * Buckets are listed account wide but addressed regionally, so drilling into
 * one found outside the region in scope needs a client the scoped bundle does
 * not hold.
 */
import { GetBucketLocationCommand, S3Client } from "@aws-sdk/client-s3";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { AwsScope } from "@faws/contracts";

import { callAws, s3Client } from "../../clients.ts";

/**
 * Regions keyed by `profile::bucket`.
 *
 * A bucket's home region never changes, and every object call needs it, so the
 * lookup happens once per process rather than once per request.
 */
const regions = new Map<string, string>();

/** The region a bucket lives in, which is not always the one in scope. */
export async function bucketRegion(scope: AwsScope, bucket: string): Promise<string> {
  const key = `${scope.profile}::${bucket}`;
  const cached = regions.get(key);
  if (cached) return cached;

  const page = await callAws("s3", () =>
    s3Client(scope).send(new GetBucketLocationCommand({ Bucket: bucket })),
  );
  // An empty or absent constraint means us-east-1, which is the one region the
  // API reports by saying nothing.
  const region = page.LocationConstraint ?? "us-east-1";
  regions.set(key, region);
  return region;
}

/** Clients for regions other than the one in scope, keyed by `profile::region`. */
const crossRegion = new Map<string, S3Client>();

export async function s3ClientForBucket(scope: AwsScope, bucket: string): Promise<S3Client> {
  const region = await bucketRegion(scope, bucket);
  if (region === scope.region) return s3Client(scope);

  const key = `${scope.profile}::${region}`;
  const existing = crossRegion.get(key);
  if (existing) return existing;

  const client = new S3Client({
    region,
    credentials: fromNodeProviderChain(scope.profile ? { profile: scope.profile } : {}),
    followRegionRedirects: true,
    // A checksum computed at signing time is computed over no body, and S3
    // then rejects the real bytes against it, so presigned uploads fail.
    // TLS covers the transfer and the etag is compared at completion.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  crossRegion.set(key, client);
  return client;
}
