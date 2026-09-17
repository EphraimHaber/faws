import { ListObjectsV2Command, type _Object, type CommonPrefix } from "@aws-sdk/client-s3";
import type {
  AwsScope,
  S3CommonPrefix,
  S3ListPage,
  S3ListObjectsInput,
  S3ObjectSummary,
} from "@faws/contracts";
import { keyName, toIso } from "@faws/shared";

import { callAws } from "../../clients.ts";
import { s3ClientForBucket } from "./buckets.ts";

/**
 * One page of a listing, and the cursor for the next.
 *
 * Exactly one `ListObjectsV2` call: a prefix can hold millions of keys, so
 * following the continuation token here would build a response neither side
 * can hold. The caller decides whether to ask for more.
 */
export async function listObjectsPage(
  scope: AwsScope,
  input: S3ListObjectsInput,
): Promise<S3ListPage> {
  const client = await s3ClientForBucket(scope, input.bucket);

  const page = await callAws("s3", () =>
    client.send(
      new ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: input.prefix,
        MaxKeys: input.maxKeys,
        ...(input.delimiter ? { Delimiter: input.delimiter } : {}),
        ...(input.cursor ? { ContinuationToken: input.cursor } : {}),
      }),
    ),
  );

  return {
    bucket: input.bucket,
    prefix: input.prefix,
    prefixes: (page.CommonPrefixes ?? []).map(toCommonPrefix),
    // A prefix is also returned as a zero byte key by whatever created it as a
    // folder; showing it as a file beside the folder it stands for is noise.
    objects: (page.Contents ?? [])
      .filter((object) => object.Key !== undefined && object.Key !== input.prefix)
      .map((object) => toObject(object, input.prefix)),
    nextToken: page.IsTruncated ? (page.NextContinuationToken ?? null) : null,
  };
}

function toCommonPrefix(prefix: CommonPrefix): S3CommonPrefix {
  const value = prefix.Prefix ?? "";
  return { prefix: value, name: keyName(value) };
}

function toObject(object: _Object, listedPrefix: string): S3ObjectSummary {
  const key = object.Key ?? "";
  return {
    key,
    name: key.startsWith(listedPrefix) ? key.slice(listedPrefix.length) : key,
    size: object.Size ?? 0,
    lastModified: toIso(object.LastModified),
    // Quoted by the API; the quotes are never what anyone wants to read or paste.
    etag: object.ETag ? object.ETag.replaceAll('"', "") : null,
    storageClass: object.StorageClass ?? "STANDARD",
  };
}
