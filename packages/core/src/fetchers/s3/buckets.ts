import {
  GetBucketLocationCommand,
  ListBucketsCommand,
  S3Client,
  type Bucket,
} from "@aws-sdk/client-s3";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { AwsScope, S3Bucket } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { callAws, s3Client } from "../../clients.ts";

/**
 * Every bucket the caller can see.
 *
 * `ListBuckets` is account wide rather than regional and returns everything in
 * one response, so this is the one S3 listing that has no cursor.
 */
export async function listBuckets(scope: AwsScope): Promise<S3Bucket[]> {
  const client = s3Client(scope);
  const page = await callAws("s3", () => client.send(new ListBucketsCommand({})));
  return (page.Buckets ?? []).map(toBucket).toSorted((a, b) => a.name.localeCompare(b.name));
}

function toBucket(bucket: Bucket): S3Bucket {
  return {
    name: bucket.Name ?? "",
    createdAt: toIso(bucket.CreationDate),
    // Filled in by `bucketRegion` when something drills into the bucket.
    region: null,
  };
}

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

/** Clients for regions other than the one in scope, keyed the same way. */
const crossRegion = new Map<string, S3Client>();

/**
 * A client pointed at the bucket's own region.
 *
 * Buckets are listed account wide but addressed regionally, so drilling into
 * one found outside the current scope needs a client the scoped bundle does
 * not hold.
 */
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
  });
  crossRegion.set(key, client);
  return client;
}
