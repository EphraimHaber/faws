import type { Readable } from "node:stream";

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type _Object,
  type CommonPrefix,
} from "@aws-sdk/client-s3";
import type {
  AwsScope,
  S3CommonPrefix,
  S3ListPage,
  S3ListObjectsInput,
  S3ObjectHead,
  S3ObjectSummary,
} from "@faws/contracts";
import { keyName, toIso } from "@faws/shared";

import { callAws } from "../../clients.ts";
import { s3ClientForBucket } from "./buckets.ts";
import { classifyOpenAs, isReadable } from "./openAs.ts";

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

/**
 * What an object is, before deciding whether to fetch it.
 *
 * Every open starts here: the size decides whether the bytes are read whole,
 * in a leading slice, or not at all, and the type decides what would render
 * them. Fetching first and asking afterwards is how a viewer meets a multi
 * gigabyte object.
 */
export async function headObject(
  scope: AwsScope,
  ref: { bucket: string; key: string; versionId?: string },
): Promise<S3ObjectHead | null> {
  const client = await s3ClientForBucket(scope, ref.bucket);

  const head = await callAws("s3", async () => {
    try {
      return await client.send(
        new HeadObjectCommand({
          Bucket: ref.bucket,
          Key: ref.key,
          ...(ref.versionId ? { VersionId: ref.versionId } : {}),
        }),
      );
    } catch (err) {
      // A key that is not there is an answer, not a fault: the browser asks
      // about rows that may have been deleted since the page was listed.
      const name = (err as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey") return null;
      throw err;
    }
  });
  if (!head) return null;

  const storageClass = head.StorageClass ?? "STANDARD";
  const restore = head.Restore ?? null;
  const contentType = head.ContentType ?? null;

  return {
    bucket: ref.bucket,
    key: ref.key,
    size: head.ContentLength ?? 0,
    contentType,
    contentEncoding: head.ContentEncoding ?? null,
    lastModified: toIso(head.LastModified),
    etag: head.ETag ? head.ETag.replaceAll('"', "") : null,
    versionId: head.VersionId ?? null,
    storageClass,
    serverSideEncryption: head.ServerSideEncryption ?? null,
    kmsKeyId: head.SSEKMSKeyId ?? null,
    metadata: head.Metadata ?? {},
    openAs: classifyOpenAs(ref.key, contentType),
    readable: isReadable(storageClass, restore),
    restore,
  };
}

/** A body, plus the headers a proxying response has to carry over. */
export interface ObjectStream {
  readonly body: Readable;
  readonly contentLength: number | null;
  readonly contentRange: string | null;
  readonly contentType: string | null;
  readonly contentEncoding: string | null;
  readonly etag: string | null;
}

/**
 * The bytes, or a slice of them.
 *
 * The body is a stream rather than a buffer, so an object larger than memory
 * costs no more to serve than a small one, and an abandoned request tears the
 * read down with it.
 */
export async function getObjectStream(
  scope: AwsScope,
  ref: { bucket: string; key: string; versionId?: string },
  options: { range?: string; signal?: AbortSignal } = {},
): Promise<ObjectStream> {
  const client = await s3ClientForBucket(scope, ref.bucket);

  const result = await callAws("s3", () =>
    client.send(
      new GetObjectCommand({
        Bucket: ref.bucket,
        Key: ref.key,
        ...(ref.versionId ? { VersionId: ref.versionId } : {}),
        ...(options.range ? { Range: options.range } : {}),
      }),
      { ...(options.signal ? { abortSignal: options.signal } : {}) },
    ),
  );

  return {
    body: result.Body as Readable,
    contentLength: result.ContentLength ?? null,
    contentRange: result.ContentRange ?? null,
    contentType: result.ContentType ?? null,
    contentEncoding: result.ContentEncoding ?? null,
    etag: result.ETag ? result.ETag.replaceAll('"', "") : null,
  };
}
