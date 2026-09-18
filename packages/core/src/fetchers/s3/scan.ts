import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { AwsScope, S3ObjectSummary, S3PrefixRollup, S3ScanProgress } from "@faws/contracts";
import { compileMatcher, toIso } from "@faws/shared";

import { callAws } from "../../clients.ts";
import { s3ClientForBucket } from "./buckets.ts";

export interface ScanInput {
  readonly bucket: string;
  readonly prefix: string;
  /** Absent means every key, which is what a size rollup wants. */
  readonly pattern?: string;
  readonly maxObjects: number;
  readonly maxSeconds: number;
}

export interface ScanChunk {
  readonly objects: ReadonlyArray<S3ObjectSummary>;
  readonly progress: S3ScanProgress;
  readonly rollup: S3PrefixRollup;
}

/** Keys per request; the API's own ceiling, since nothing here is rendered. */
const PAGE_SIZE = 1000;

/**
 * Every key under a prefix, matched as the walk goes.
 *
 * A generator rather than a function returning a list: a prefix can hold
 * millions of keys, and the caller wants the first matches while the rest are
 * still being read. Matching during the walk is also what keeps a scan from
 * materialising a bucket in order to filter it afterwards.
 *
 * The signal is checked between pages and handed to each request, so
 * abandoning a scan stops the work rather than leaving it running to
 * completion unobserved.
 */
export async function* scanPrefix(
  scope: AwsScope,
  input: ScanInput,
  signal: AbortSignal,
): AsyncGenerator<ScanChunk> {
  const client = await s3ClientForBucket(scope, input.bucket);
  const matches = compileMatcher(input.pattern ?? "");
  const deadline = Date.now() + input.maxSeconds * 1000;

  let token: string | undefined;
  let scanned = 0;
  let matched = 0;
  let bytes = 0;
  let matchedBytes = 0;
  const byStorageClass: Record<string, number> = {};
  let truncated = false;

  do {
    if (signal.aborted) return;

    const page = await callAws("s3", () =>
      client.send(
        new ListObjectsV2Command({
          Bucket: input.bucket,
          Prefix: input.prefix,
          MaxKeys: PAGE_SIZE,
          ...(token ? { ContinuationToken: token } : {}),
        }),
        { abortSignal: signal },
      ),
    );

    const hits: S3ObjectSummary[] = [];
    let lastKey = input.prefix;

    for (const object of page.Contents ?? []) {
      const key = object.Key;
      if (key === undefined) continue;
      lastKey = key;
      scanned += 1;
      const size = object.Size ?? 0;
      bytes += size;
      const storageClass = object.StorageClass ?? "STANDARD";
      byStorageClass[storageClass] = (byStorageClass[storageClass] ?? 0) + size;

      // The relative key is what a pattern is written against: someone
      // searching inside a prefix does not repeat the prefix in the query.
      const relative = key.startsWith(input.prefix) ? key.slice(input.prefix.length) : key;
      if (!matches(relative)) continue;

      matched += 1;
      matchedBytes += size;
      hits.push({
        key,
        name: relative,
        size,
        lastModified: toIso(object.LastModified),
        etag: object.ETag ? object.ETag.replaceAll('"', "") : null,
        storageClass,
      });
    }

    // A ceiling on either axis stops the scan and says so, rather than letting
    // one query walk a bucket for an hour.
    if (scanned >= input.maxObjects || Date.now() > deadline) truncated = true;

    token = page.IsTruncated && !truncated ? page.NextContinuationToken : undefined;

    yield {
      objects: hits,
      progress: {
        scanned,
        matched,
        bytes,
        currentPrefix: lastKey,
        done: !token,
        truncated,
      },
      rollup: {
        prefix: input.prefix,
        objectCount: matched,
        totalBytes: matchedBytes,
        byStorageClass: { ...byStorageClass },
      },
    };
  } while (token);
}
