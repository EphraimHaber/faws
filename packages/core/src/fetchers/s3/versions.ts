import { ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import type { AwsScope, S3VersionEntry, S3VersionPage } from "@faws/contracts";
import { toIso } from "@faws/shared";

import { callAws } from "../../clients.ts";
import { s3ClientForBucket } from "./buckets.ts";

/**
 * Versions and delete markers under a prefix, newest first per key.
 *
 * This is the one listing that pages on two markers rather than a single
 * token: a key can have more versions than fit in a page, so the cursor has to
 * say both which key and which version to resume from.
 *
 * Delete markers are included deliberately. On a versioned bucket the marker
 * is the reason an object looks gone, and hiding it makes a recoverable delete
 * indistinguishable from a real one.
 */
export async function listObjectVersions(
  scope: AwsScope,
  input: {
    bucket: string;
    prefix: string;
    keyMarker?: string;
    versionIdMarker?: string;
    maxKeys?: number;
  },
): Promise<S3VersionPage> {
  const client = await s3ClientForBucket(scope, input.bucket);

  const page = await callAws("s3", () =>
    client.send(
      new ListObjectVersionsCommand({
        Bucket: input.bucket,
        Prefix: input.prefix,
        MaxKeys: input.maxKeys ?? 200,
        ...(input.keyMarker ? { KeyMarker: input.keyMarker } : {}),
        ...(input.versionIdMarker ? { VersionIdMarker: input.versionIdMarker } : {}),
      }),
    ),
  );

  const versions: S3VersionEntry[] = [
    ...(page.Versions ?? []).map((entry) => ({
      key: entry.Key ?? "",
      versionId: entry.VersionId ?? "null",
      isLatest: entry.IsLatest ?? false,
      isDeleteMarker: false,
      size: entry.Size ?? 0,
      lastModified: toIso(entry.LastModified),
      etag: entry.ETag ? entry.ETag.replaceAll('"', "") : null,
      storageClass: entry.StorageClass ?? "STANDARD",
    })),
    ...(page.DeleteMarkers ?? []).map((entry) => ({
      key: entry.Key ?? "",
      versionId: entry.VersionId ?? "null",
      isLatest: entry.IsLatest ?? false,
      isDeleteMarker: true,
      size: 0,
      lastModified: toIso(entry.LastModified),
      etag: null,
      storageClass: "",
    })),
  ].toSorted((a, b) =>
    // Grouped by key, and within a key the newest first, which is the order
    // the two lists arrive in separately.
    a.key === b.key
      ? (b.lastModified ?? "").localeCompare(a.lastModified ?? "")
      : a.key.localeCompare(b.key),
  );

  return {
    versions,
    nextKeyMarker: page.IsTruncated ? (page.NextKeyMarker ?? null) : null,
    nextVersionIdMarker: page.IsTruncated ? (page.NextVersionIdMarker ?? null) : null,
  };
}
