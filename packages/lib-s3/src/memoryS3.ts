/**
 * An in-memory S3 behind every `S3Client`, for tests.
 *
 * `aws-sdk-client-mock` replaces `send` on the client class, and the handlers
 * here answer each command the engine uses from one shared set of buckets, so
 * a port can be exercised end to end without a network: listing with a
 * delimiter and a cursor, ranges, conditional writes, multipart assembly and
 * copies all behave as S3 documents them.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetBucketLocationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";

interface StoredObject {
  body: Buffer;
  contentType: string | undefined;
  lastModified: Date;
  etag: string;
  tags: Record<string, string>;
}

interface StoredBucket {
  region: string;
  createdAt: Date;
  objects: Map<string, StoredObject>;
  uploads: Map<
    string,
    { key: string; contentType: string | undefined; parts: Map<number, Buffer> }
  >;
}

export interface MemoryS3Seed {
  readonly buckets: ReadonlyArray<{
    name: string;
    region?: string;
    objects?: ReadonlyArray<{ key: string; body: string; contentType?: string }>;
  }>;
}

function failure(name: string, message = name): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

function etagOf(body: Buffer): string {
  return `"${createHash("md5").update(body).digest("hex")}"`;
}

async function bytesOf(body: unknown): Promise<Buffer> {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Installs the fake on every S3 client and returns a restore function. */
export function installMemoryS3(seed: MemoryS3Seed): () => void {
  const buckets = new Map<string, StoredBucket>();
  for (const entry of seed.buckets) {
    const objects = new Map<string, StoredObject>();
    for (const object of entry.objects ?? []) {
      const body = Buffer.from(object.body);
      objects.set(object.key, {
        body,
        contentType: object.contentType,
        lastModified: new Date("2026-01-01T00:00:00Z"),
        etag: etagOf(body),
        tags: {},
      });
    }
    buckets.set(entry.name, {
      region: entry.region ?? "us-east-1",
      createdAt: new Date("2025-06-01T00:00:00Z"),
      objects,
      uploads: new Map(),
    });
  }

  const bucketNamed = (name: string | undefined): StoredBucket => {
    const found = name === undefined ? undefined : buckets.get(name);
    if (!found) throw failure("NoSuchBucket", `The bucket ${name} does not exist.`);
    return found;
  };

  const objectAt = (bucket: string | undefined, key: string | undefined): StoredObject => {
    const found = key === undefined ? undefined : bucketNamed(bucket).objects.get(key);
    if (!found) throw failure("NotFound", "Not Found");
    return found;
  };

  const write = (bucket: StoredBucket, key: string, body: Buffer, contentType?: string) => {
    const stored: StoredObject = {
      body,
      contentType,
      lastModified: new Date(),
      etag: etagOf(body),
      tags: {},
    };
    bucket.objects.set(key, stored);
    return stored;
  };

  const refuseExisting = (bucket: StoredBucket, key: string, ifNoneMatch: string | undefined) => {
    if (ifNoneMatch === "*" && bucket.objects.has(key)) {
      throw failure("PreconditionFailed", "At least one of the preconditions did not hold.");
    }
  };

  const mock = mockClient(S3Client);

  mock.on(ListBucketsCommand).callsFake(async () => ({
    Buckets: [...buckets].map(([name, bucket]) => ({ Name: name, CreationDate: bucket.createdAt })),
  }));

  mock.on(GetBucketLocationCommand).callsFake(async (input: { Bucket?: string }) => {
    const region = bucketNamed(input.Bucket).region;
    return { LocationConstraint: region === "us-east-1" ? undefined : region };
  });

  mock.on(GetBucketVersioningCommand).callsFake(async (input: { Bucket?: string }) => {
    bucketNamed(input.Bucket);
    return {};
  });

  mock
    .on(ListObjectsV2Command)
    .callsFake(
      async (input: {
        Bucket?: string;
        Prefix?: string;
        Delimiter?: string;
        MaxKeys?: number;
        ContinuationToken?: string;
      }) => {
        const bucket = bucketNamed(input.Bucket);
        const prefix = input.Prefix ?? "";
        const entries: Array<{ prefix: string } | { key: string; object: StoredObject }> = [];
        const seen = new Set<string>();
        for (const key of [...bucket.objects.keys()].toSorted()) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          const cut = input.Delimiter ? rest.indexOf(input.Delimiter) : -1;
          if (cut >= 0) {
            const common = prefix + rest.slice(0, cut + 1);
            if (!seen.has(common)) {
              seen.add(common);
              entries.push({ prefix: common });
            }
          } else {
            entries.push({ key, object: bucket.objects.get(key) as StoredObject });
          }
        }
        const start = Number(input.ContinuationToken ?? 0);
        const end = start + (input.MaxKeys ?? 1000);
        const page = entries.slice(start, end);
        const truncated = end < entries.length;
        return {
          CommonPrefixes: page.flatMap((entry) =>
            "prefix" in entry ? [{ Prefix: entry.prefix }] : [],
          ),
          Contents: page.flatMap((entry) =>
            "key" in entry
              ? [
                  {
                    Key: entry.key,
                    Size: entry.object.body.length,
                    LastModified: entry.object.lastModified,
                    ETag: entry.object.etag,
                    StorageClass: "STANDARD" as const,
                  },
                ]
              : [],
          ),
          IsTruncated: truncated,
          ...(truncated ? { NextContinuationToken: String(end) } : {}),
        };
      },
    );

  mock
    .on(ListObjectVersionsCommand)
    .callsFake(async (input: { Bucket?: string; Prefix?: string }) => {
      const bucket = bucketNamed(input.Bucket);
      const prefix = input.Prefix ?? "";
      return {
        Versions: [...bucket.objects]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, object]) => ({
            Key: key,
            VersionId: "null",
            IsLatest: true,
            Size: object.body.length,
            LastModified: object.lastModified,
            ETag: object.etag,
            StorageClass: "STANDARD" as const,
          })),
        IsTruncated: false,
      };
    });

  mock.on(HeadObjectCommand).callsFake(async (input: { Bucket?: string; Key?: string }) => {
    const object = objectAt(input.Bucket, input.Key);
    return {
      ContentLength: object.body.length,
      ContentType: object.contentType,
      LastModified: object.lastModified,
      ETag: object.etag,
    };
  });

  mock
    .on(GetObjectCommand)
    .callsFake(async (input: { Bucket?: string; Key?: string; Range?: string }) => {
      const object = objectAt(input.Bucket, input.Key);
      const total = object.body.length;
      const range = /^bytes=(\d+)-(\d*)$/.exec(input.Range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
      const slice = object.body.subarray(start, end + 1);
      return {
        Body: Readable.from([slice]),
        ContentLength: slice.length,
        ContentType: object.contentType,
        ETag: object.etag,
        ...(range ? { ContentRange: `bytes ${start}-${end}/${total}` } : {}),
      };
    });

  mock
    .on(PutObjectCommand)
    .callsFake(
      async (input: {
        Bucket?: string;
        Key?: string;
        Body?: unknown;
        ContentType?: string;
        IfNoneMatch?: string;
      }) => {
        const bucket = bucketNamed(input.Bucket);
        const key = input.Key ?? "";
        refuseExisting(bucket, key, input.IfNoneMatch);
        const stored = write(bucket, key, await bytesOf(input.Body), input.ContentType);
        return { ETag: stored.etag };
      },
    );

  mock
    .on(CreateMultipartUploadCommand)
    .callsFake(async (input: { Bucket?: string; Key?: string; ContentType?: string }) => {
      const bucket = bucketNamed(input.Bucket);
      const uploadId = crypto.randomUUID();
      bucket.uploads.set(uploadId, {
        key: input.Key ?? "",
        contentType: input.ContentType,
        parts: new Map(),
      });
      return { UploadId: uploadId };
    });

  mock
    .on(UploadPartCommand)
    .callsFake(
      async (input: {
        Bucket?: string;
        UploadId?: string;
        PartNumber?: number;
        Body?: unknown;
      }) => {
        const upload = bucketNamed(input.Bucket).uploads.get(input.UploadId ?? "");
        if (!upload) throw failure("NoSuchUpload");
        const body = await bytesOf(input.Body);
        upload.parts.set(input.PartNumber ?? 0, body);
        return { ETag: etagOf(body) };
      },
    );

  mock
    .on(CompleteMultipartUploadCommand)
    .callsFake(
      async (input: {
        Bucket?: string;
        UploadId?: string;
        IfNoneMatch?: string;
        MultipartUpload?: { Parts?: Array<{ PartNumber?: number; ETag?: string }> };
      }) => {
        const bucket = bucketNamed(input.Bucket);
        const upload = bucket.uploads.get(input.UploadId ?? "");
        if (!upload) throw failure("NoSuchUpload");
        const parts = input.MultipartUpload?.Parts ?? [];
        const numbers = parts.map((part) => part.PartNumber ?? 0);
        if (numbers.some((value, index) => index > 0 && value <= (numbers[index - 1] ?? 0))) {
          throw failure("InvalidPartOrder");
        }
        const body = Buffer.concat(
          parts.map((part) => {
            const stored = upload.parts.get(part.PartNumber ?? 0);
            if (!stored || etagOf(stored) !== part.ETag) throw failure("InvalidPart");
            return stored;
          }),
        );
        refuseExisting(bucket, upload.key, input.IfNoneMatch);
        bucket.uploads.delete(input.UploadId ?? "");
        const stored = write(bucket, upload.key, body, upload.contentType);
        return { ETag: stored.etag };
      },
    );

  mock
    .on(AbortMultipartUploadCommand)
    .callsFake(async (input: { Bucket?: string; UploadId?: string }) => {
      bucketNamed(input.Bucket).uploads.delete(input.UploadId ?? "");
      return {};
    });

  mock
    .on(DeleteObjectsCommand)
    .callsFake(
      async (input: { Bucket?: string; Delete?: { Objects?: Array<{ Key?: string }> } }) => {
        const bucket = bucketNamed(input.Bucket);
        const keys = (input.Delete?.Objects ?? []).map((entry) => entry.Key ?? "");
        for (const key of keys) bucket.objects.delete(key);
        return { Deleted: keys.map((key) => ({ Key: key })), Errors: [] };
      },
    );

  mock
    .on(CopyObjectCommand)
    .callsFake(
      async (input: {
        Bucket?: string;
        Key?: string;
        CopySource?: string;
        IfNoneMatch?: string;
      }) => {
        const source = decodeURI(input.CopySource ?? "");
        const slash = source.indexOf("/");
        const original = objectAt(source.slice(0, slash), source.slice(slash + 1));
        const bucket = bucketNamed(input.Bucket);
        const key = input.Key ?? "";
        refuseExisting(bucket, key, input.IfNoneMatch);
        const stored = write(bucket, key, Buffer.from(original.body), original.contentType);
        return { CopyObjectResult: { ETag: stored.etag } };
      },
    );

  mock
    .on(PutObjectTaggingCommand)
    .callsFake(
      async (input: {
        Bucket?: string;
        Key?: string;
        Tagging?: { TagSet?: Array<{ Key?: string; Value?: string }> };
      }) => {
        const object = objectAt(input.Bucket, input.Key);
        object.tags = Object.fromEntries(
          (input.Tagging?.TagSet ?? []).map((tag) => [tag.Key ?? "", tag.Value ?? ""]),
        );
        return {};
      },
    );

  return () => mock.restore();
}
