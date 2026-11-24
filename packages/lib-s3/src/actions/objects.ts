import type { Readable } from "node:stream";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  UploadPartCommand,
  UploadPartCopyCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import type { StorageDeleteOutcome, StoragePutResult } from "@faws/kit/server";

import { assertDestructive, assertMutable } from "@faws/kit/guard";

import { callS3 } from "../call.ts";

/** `CopyObject` refuses anything larger, which then needs a multipart copy. */
const COPY_LIMIT = 5 * 1024 * 1024 * 1024;

/** Part size for a multipart copy. Large enough that 10,000 parts reach 5 TB. */
const COPY_PART_SIZE = 1024 * 1024 * 1024;

/**
 * Writes an object in one request.
 *
 * `overwrite: false` is enforced with a conditional write rather than a prior
 * head: checking and then writing is a race, and the race is lost exactly when
 * two people are uploading the same key.
 */
export async function putObject(
  client: S3Client,
  input: {
    bucket: string;
    key: string;
    body: Readable | Uint8Array;
    contentLength: number;
    contentType?: string | undefined;
    overwrite: boolean;
  },
): Promise<StoragePutResult> {
  // Replacing an object destroys what was there; writing a new one does not.
  if (input.overwrite) assertDestructive("s3:PutObject (overwrite)");
  else assertMutable("s3:PutObject");
  const result = await callS3(() =>
    client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentLength: input.contentLength,
        ...(input.contentType ? { ContentType: input.contentType } : {}),
        ...(input.overwrite ? {} : { IfNoneMatch: "*" }),
      }),
    ),
  );
  return { etag: unquote(result.ETag), versionId: result.VersionId ?? null };
}

export async function createMultipartUpload(
  client: S3Client,
  input: { bucket: string; key: string; contentType?: string | undefined },
): Promise<string> {
  assertMutable("s3:CreateMultipartUpload");
  const result = await callS3(() =>
    client.send(
      new CreateMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        ...(input.contentType ? { ContentType: input.contentType } : {}),
      }),
    ),
  );
  if (!result.UploadId) throw new Error("S3 did not return an upload id.");
  return result.UploadId;
}

export async function uploadPart(
  client: S3Client,
  input: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    body: Readable | Uint8Array;
    contentLength: number;
  },
): Promise<string> {
  assertMutable("s3:UploadPart");
  const result = await callS3(() =>
    client.send(
      new UploadPartCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
        Body: input.body,
        ContentLength: input.contentLength,
      }),
    ),
  );
  if (!result.ETag) throw new Error(`Part ${input.partNumber} returned no etag.`);
  return unquote(result.ETag) ?? "";
}

export async function completeMultipartUpload(
  client: S3Client,
  input: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: ReadonlyArray<{ partNumber: number; etag: string }>;
    overwrite: boolean;
  },
): Promise<StoragePutResult> {
  if (input.overwrite) assertDestructive("s3:CompleteMultipartUpload (overwrite)");
  else assertMutable("s3:CompleteMultipartUpload");
  const result = await callS3(() =>
    client.send(
      new CompleteMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: {
          // S3 rejects parts out of order, and the client uploads them in
          // whatever order they finish.
          Parts: [...input.parts]
            .toSorted((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({ PartNumber: part.partNumber, ETag: `"${part.etag}"` })),
        },
        ...(input.overwrite ? {} : { IfNoneMatch: "*" }),
      }),
    ),
  );
  return { etag: unquote(result.ETag), versionId: result.VersionId ?? null };
}

/** Abandoned uploads bill as storage until they are aborted. */
export async function abortMultipartUpload(
  client: S3Client,
  input: { bucket: string; key: string; uploadId: string },
): Promise<void> {
  await callS3(() =>
    client.send(
      new AbortMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
      }),
    ),
  );
}

/**
 * Deletes up to a thousand keys.
 *
 * `DeleteObjects` answers 200 with a list of the keys it could not delete, so
 * a caller that only checks for a thrown error reports a success that did not
 * happen. The failures are returned rather than raised.
 */
export async function deleteObjects(
  client: S3Client,
  input: {
    bucket: string;
    objects: ReadonlyArray<{ key: string; versionId?: string | undefined }>;
  },
): Promise<StorageDeleteOutcome> {
  assertDestructive("s3:DeleteObjects");
  const result = await callS3(() =>
    client.send(
      new DeleteObjectsCommand({
        Bucket: input.bucket,
        Delete: {
          Objects: input.objects.map((object) => ({
            Key: object.key,
            ...(object.versionId ? { VersionId: object.versionId } : {}),
          })),
          Quiet: false,
        },
      }),
    ),
  );

  return {
    deleted: (result.Deleted ?? []).map((entry) => ({
      key: entry.Key ?? "",
      versionId: entry.VersionId ?? null,
    })),
    errors: (result.Errors ?? []).map((entry) => ({
      key: entry.Key ?? "",
      code: entry.Code ?? "Unknown",
      message: entry.Message ?? "",
    })),
  };
}

/**
 * Copies an object, and optionally removes the original.
 *
 * A move is the copy and the delete as two audited steps, and the delete only
 * runs once the copy has been confirmed: the opposite order loses data on any
 * failure between them.
 */
export async function copyObject(
  client: S3Client,
  // The source bucket can live in another region from the destination.
  source: S3Client,
  input: {
    sourceBucket: string;
    sourceKey: string;
    sourceVersionId?: string | undefined;
    destBucket: string;
    destKey: string;
    deleteSource: boolean;
    overwrite: boolean;
  },
): Promise<StoragePutResult> {
  if (input.deleteSource) assertDestructive("s3:CopyObject (move)");
  else if (input.overwrite) assertDestructive("s3:CopyObject (overwrite)");
  else assertMutable("s3:CopyObject");

  const head = await callS3(() =>
    source.send(
      new HeadObjectCommand({
        Bucket: input.sourceBucket,
        Key: input.sourceKey,
        ...(input.sourceVersionId ? { VersionId: input.sourceVersionId } : {}),
      }),
    ),
  );
  const size = head.ContentLength ?? 0;

  const copySource = encodeURI(
    `${input.sourceBucket}/${input.sourceKey}${
      input.sourceVersionId ? `?versionId=${input.sourceVersionId}` : ""
    }`,
  );

  const result =
    size > COPY_LIMIT
      ? await multipartCopy(client, input, copySource, size)
      : await callS3(() =>
          client
            .send(
              new CopyObjectCommand({
                Bucket: input.destBucket,
                Key: input.destKey,
                CopySource: copySource,
                ...(input.overwrite ? {} : { IfNoneMatch: "*" }),
              }),
            )
            .then((response) => ({
              etag: unquote(response.CopyObjectResult?.ETag),
              versionId: response.VersionId ?? null,
            })),
        );

  if (input.deleteSource) {
    await deleteObjects(source, {
      bucket: input.sourceBucket,
      objects: [
        {
          key: input.sourceKey,
          ...(input.sourceVersionId ? { versionId: input.sourceVersionId } : {}),
        },
      ],
    });
  }

  return result;
}

/**
 * The copy path for objects past the single request limit.
 *
 * Without this a move of anything larger than five gigabytes fails at the
 * copy, which is the failure most likely to be mistaken for success.
 */
async function multipartCopy(
  client: S3Client,
  input: { destBucket: string; destKey: string },
  copySource: string,
  size: number,
): Promise<StoragePutResult> {
  const created = await callS3(() =>
    client.send(new CreateMultipartUploadCommand({ Bucket: input.destBucket, Key: input.destKey })),
  );
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error("S3 did not return an upload id for the copy.");

  try {
    const parts: Array<{ PartNumber: number; ETag: string }> = [];
    let partNumber = 1;
    for (let start = 0; start < size; start += COPY_PART_SIZE) {
      const end = Math.min(start + COPY_PART_SIZE, size) - 1;
      const part = await callS3(() =>
        client.send(
          new UploadPartCopyCommand({
            Bucket: input.destBucket,
            Key: input.destKey,
            UploadId: uploadId,
            PartNumber: partNumber,
            CopySource: copySource,
            CopySourceRange: `bytes=${start}-${end}`,
          }),
        ),
      );
      parts.push({ PartNumber: partNumber, ETag: part.CopyPartResult?.ETag ?? "" });
      partNumber += 1;
    }

    const done = await callS3(() =>
      client.send(
        new CompleteMultipartUploadCommand({
          Bucket: input.destBucket,
          Key: input.destKey,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      ),
    );
    return { etag: unquote(done.ETag), versionId: done.VersionId ?? null };
  } catch (err) {
    // A half copied multipart bills as storage until it is abandoned.
    await callS3(() =>
      client.send(
        new AbortMultipartUploadCommand({
          Bucket: input.destBucket,
          Key: input.destKey,
          UploadId: uploadId,
        }),
      ),
    ).catch(() => undefined);
    throw err;
  }
}

/** A folder, as S3 understands one: a zero byte object whose key ends in a slash. */
export async function createPrefix(
  client: S3Client,
  input: { bucket: string; prefix: string },
): Promise<void> {
  assertMutable("s3:PutObject (prefix)");
  const key = input.prefix.endsWith("/") ? input.prefix : `${input.prefix}/`;
  await callS3(() =>
    client.send(
      new PutObjectCommand({ Bucket: input.bucket, Key: key, Body: "", ContentLength: 0 }),
    ),
  );
}

/** Replaces the object's tag set; an empty record clears it. */
export async function putObjectTags(
  client: S3Client,
  input: { bucket: string; key: string; tags: Readonly<Record<string, string>> },
): Promise<void> {
  assertMutable("s3:PutObjectTagging");
  await callS3(() =>
    client.send(
      new PutObjectTaggingCommand({
        Bucket: input.bucket,
        Key: input.key,
        Tagging: {
          TagSet: Object.entries(input.tags).map(([Key, Value]) => ({ Key, Value })),
        },
      }),
    ),
  );
}

function unquote(etag: string | undefined): string | null {
  return etag ? etag.replaceAll('"', "") : null;
}
