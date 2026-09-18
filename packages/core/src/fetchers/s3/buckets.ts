import {
  GetBucketLocationCommand,
  GetBucketVersioningCommand,
  ListBucketsCommand,
  S3Client,
  type Bucket,
} from "@aws-sdk/client-s3";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { S3Bucket, S3Scope } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { callAws, s3Client } from "../../clients.ts";
import { connectionFor } from "../../s3/connections.ts";
import { endpointClient } from "../../s3/endpointClient.ts";

/**
 * A client for calls that are not about a particular bucket.
 *
 * With a connection in scope there is one endpoint and one region, so this is
 * also the client every bucket uses.
 */
export async function s3ClientFor(scope: S3Scope): Promise<S3Client> {
  const connection = await connectionFor(scope);
  return connection ? endpointClient(connection) : s3Client(scope);
}

/**
 * Every bucket the caller can see.
 *
 * `ListBuckets` is account wide rather than regional and returns everything in
 * one response, so this is the one S3 listing that has no cursor.
 */
export async function listBuckets(scope: S3Scope): Promise<S3Bucket[]> {
  const client = await s3ClientFor(scope);
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
export async function bucketRegion(scope: S3Scope, bucket: string): Promise<string> {
  const connection = await connectionFor(scope);
  // One endpoint serves every bucket it has, and asking it where a bucket
  // lives either answers with its own configured region or is not implemented
  // at all, so the configured region is the whole answer.
  if (connection) return connection.region;

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
export async function s3ClientForBucket(scope: S3Scope, bucket: string): Promise<S3Client> {
  const connection = await connectionFor(scope);
  if (connection) return endpointClient(connection);

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

/**
 * Whether the bucket keeps versions.
 *
 * It decides whether a delete is recoverable, which is the one fact a
 * confirmation must not guess at. A bucket that has never had versioning
 * configured reports no status at all, which means the same as off.
 */
export async function bucketVersioning(scope: S3Scope, bucket: string): Promise<boolean> {
  const client = await s3ClientForBucket(scope, bucket);
  try {
    const result = await callAws("s3", () =>
      client.send(new GetBucketVersioningCommand({ Bucket: bucket })),
    );
    return result.Status === "Enabled";
  } catch {
    // Reading the configuration needs its own permission, and lacking it says
    // nothing about the bucket. Answering "not versioned" is the careful way
    // round: it is the warning worth showing when this is unknown.
    return false;
  }
}
