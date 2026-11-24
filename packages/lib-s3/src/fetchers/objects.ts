import type { Readable } from "node:stream";

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type _Object,
  type CommonPrefix,
  type S3Client,
} from "@aws-sdk/client-s3";
import type {
  StorageCommonPrefix,
  StorageListPage,
  StorageObjectHead,
  StorageObjectSummary,
} from "@faws/kit";
import type { StorageListInput, StorageObjectRef, StorageObjectStream } from "@faws/kit/server";
import { keyName, toIso } from "@faws/shared";

import { callS3 } from "../call.ts";
import { classifyOpenAs, isReadable } from "./openAs.ts";

/**
 * One page of a listing, and the cursor for the next.
 *
 * Exactly one `ListObjectsV2` call: a prefix can hold millions of keys, so
 * following the continuation token here would build a response neither side
 * can hold. The caller decides whether to ask for more.
 */
export async function listObjectsPage(
  client: S3Client,
  input: StorageListInput,
): Promise<StorageListPage> {
  const page = await callS3(() =>
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

function toCommonPrefix(prefix: CommonPrefix): StorageCommonPrefix {
  const value = prefix.Prefix ?? "";
  return { prefix: value, name: keyName(value) };
}

function toObject(object: _Object, listedPrefix: string): StorageObjectSummary {
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
  client: S3Client,
  ref: StorageObjectRef,
): Promise<StorageObjectHead | null> {
  const head = await callS3(async () => {
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

/**
 * The bytes, or a slice of them.
 *
 * The body is a stream rather than a buffer, so an object larger than memory
 * costs no more to serve than a small one, and an abandoned request tears the
 * read down with it.
 */
export async function getObjectStream(
  client: S3Client,
  ref: StorageObjectRef,
  options: { range?: string; signal?: AbortSignal } = {},
): Promise<StorageObjectStream> {
  const result = await callS3(() =>
    client.send(
      new GetObjectCommand({
        Bucket: ref.bucket,
        Key: ref.key,
        ...(ref.versionId ? { VersionId: ref.versionId } : {}),
        ...(options.range ? { Range: options.range } : {}),
      }),
      options.signal ? { abortSignal: options.signal } : {},
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
