import {
  GetBucketVersioningCommand,
  ListBucketsCommand,
  type Bucket,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { StorageBucket } from "@faws/kit";
import { toIso } from "@faws/shared";

import { callS3 } from "../call.ts";

/**
 * Every bucket the caller can see.
 *
 * `ListBuckets` is account wide rather than regional and returns everything in
 * one response, so this is the one S3 listing that has no cursor.
 */
export async function listBuckets(client: S3Client): Promise<StorageBucket[]> {
  const page = await callS3(() => client.send(new ListBucketsCommand({})));
  return (page.Buckets ?? []).map(toBucket).toSorted((a, b) => a.name.localeCompare(b.name));
}

function toBucket(bucket: Bucket): StorageBucket {
  return {
    name: bucket.Name ?? "",
    createdAt: toIso(bucket.CreationDate),
    // Resolved separately when something drills into the bucket.
    region: null,
  };
}

/**
 * Whether the bucket keeps versions.
 *
 * It decides whether a delete is recoverable, which is the one fact a
 * confirmation must not guess at. A bucket that has never had versioning
 * configured reports no status at all, which means the same as off.
 */
export async function bucketVersioning(client: S3Client, bucket: string): Promise<boolean> {
  try {
    const result = await callS3(() =>
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
