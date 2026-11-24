/**
 * The object storage capability on the server.
 *
 * A provider that stores objects implements `ObjectStoragePort` once and
 * registers it under its id. The host's storage router, byte routes and scan
 * namespace take a `ConnectionRef` and reach the provider through
 * `objectStorageFor`, so none of them knows which provider is answering.
 *
 * Every method that changes something checks the write-mode guard itself: the
 * byte routes call these without passing through tRPC, and they are held to
 * the same rule.
 */
import type { Readable } from "node:stream";

import type { ConnectionRef } from "../connection.ts";
import { ObjectStorageUnavailableError } from "../errors.ts";
import type {
  StorageBucket,
  StorageBucketConfig,
  StorageFeatures,
  StorageListPage,
  StorageMetricSeries,
  StorageObjectHead,
  StorageObjectSummary,
  StoragePrefixRollup,
  StorageScanProgress,
  StorageVersionPage,
} from "../objectStorage.ts";

export interface StorageObjectRef {
  readonly bucket: string;
  readonly key: string;
  readonly versionId?: string | undefined;
}

export interface StorageListInput {
  readonly bucket: string;
  readonly prefix: string;
  /** Absent lists every key under the prefix rather than one level of it. */
  readonly delimiter?: string | undefined;
  readonly maxKeys: number;
  readonly cursor?: string | undefined;
}

export interface StorageVersionsInput {
  readonly bucket: string;
  readonly prefix: string;
  readonly keyMarker?: string | undefined;
  readonly versionIdMarker?: string | undefined;
  readonly maxKeys?: number | undefined;
}

export interface StorageScanInput {
  readonly bucket: string;
  readonly prefix: string;
  /** Absent means every key, which is what a size rollup wants. */
  readonly pattern?: string | undefined;
  readonly maxObjects: number;
  readonly maxSeconds: number;
}

export interface StorageScanChunk {
  readonly objects: ReadonlyArray<StorageObjectSummary>;
  readonly progress: StorageScanProgress;
  readonly rollup: StoragePrefixRollup;
}

/** A body, plus the headers a proxying response has to carry over. */
export interface StorageObjectStream {
  readonly body: Readable;
  readonly contentLength: number | null;
  readonly contentRange: string | null;
  readonly contentType: string | null;
  readonly contentEncoding: string | null;
  readonly etag: string | null;
}

export interface StoragePutResult {
  readonly etag: string | null;
  readonly versionId: string | null;
}

export interface StorageDeleteOutcome {
  readonly deleted: ReadonlyArray<{ key: string; versionId: string | null }>;
  /** Per key failures, reported inside a successful response. */
  readonly errors: ReadonlyArray<{ key: string; code: string; message: string }>;
}

export interface StorageCopyInput {
  readonly sourceBucket: string;
  readonly sourceKey: string;
  readonly sourceVersionId?: string | undefined;
  readonly destBucket: string;
  readonly destKey: string;
  /** A move: the source is deleted once the copy is confirmed. */
  readonly deleteSource: boolean;
  readonly overwrite: boolean;
}

export interface ObjectStoragePort {
  /** What the UI may offer for this connection. */
  features(ref: ConnectionRef): Promise<StorageFeatures>;

  listBuckets(ref: ConnectionRef): Promise<StorageBucket[]>;
  /** The region the bucket answers in. */
  bucketRegion(ref: ConnectionRef, bucket: string): Promise<string>;
  /** Whether a delete on this bucket leaves a recoverable marker. */
  bucketVersioning(ref: ConnectionRef, bucket: string): Promise<boolean>;
  /** Everything a properties pane shows, degrading field by field. */
  bucketConfig(ref: ConnectionRef, bucket: string): Promise<StorageBucketConfig>;
  /** Daily size and object count; refused where `features` says there are none. */
  storageMetrics(
    ref: ConnectionRef,
    bucket: string,
    options: { days: number },
  ): Promise<StorageMetricSeries[]>;

  /** One page of a listing, and the cursor for the next. */
  listObjects(ref: ConnectionRef, input: StorageListInput): Promise<StorageListPage>;
  /** Versions and delete markers; this listing pages on two markers. */
  listVersions(ref: ConnectionRef, input: StorageVersionsInput): Promise<StorageVersionPage>;
  /** What an object is, or null when the key is not there. */
  head(ref: ConnectionRef, object: StorageObjectRef): Promise<StorageObjectHead | null>;
  /** The bytes, or the slice a range header names, as a stream. */
  openRead(
    ref: ConnectionRef,
    object: StorageObjectRef,
    options?: { range?: string; signal?: AbortSignal },
  ): Promise<StorageObjectStream>;
  /** Every key under a prefix, matched as the walk goes. */
  scan(
    ref: ConnectionRef,
    input: StorageScanInput,
    signal: AbortSignal,
  ): AsyncGenerator<StorageScanChunk>;

  /** Writes a whole object in one request; `overwrite: false` refuses an existing key. */
  putObject(
    ref: ConnectionRef,
    input: {
      bucket: string;
      key: string;
      body: Readable | Uint8Array;
      contentLength: number;
      contentType?: string | undefined;
      overwrite: boolean;
    },
  ): Promise<StoragePutResult>;
  /** Starts a multipart upload and returns its id. */
  createUpload(
    ref: ConnectionRef,
    input: { bucket: string; key: string; contentType?: string | undefined },
  ): Promise<string>;
  /** Uploads one part and returns its etag. */
  uploadPart(
    ref: ConnectionRef,
    input: {
      bucket: string;
      key: string;
      uploadId: string;
      partNumber: number;
      body: Readable | Uint8Array;
      contentLength: number;
    },
  ): Promise<string>;
  completeUpload(
    ref: ConnectionRef,
    input: {
      bucket: string;
      key: string;
      uploadId: string;
      parts: ReadonlyArray<{ partNumber: number; etag: string }>;
      overwrite: boolean;
    },
  ): Promise<StoragePutResult>;
  abortUpload(
    ref: ConnectionRef,
    input: { bucket: string; key: string; uploadId: string },
  ): Promise<void>;

  deleteObjects(
    ref: ConnectionRef,
    input: {
      bucket: string;
      objects: ReadonlyArray<{ key: string; versionId?: string | undefined }>;
    },
  ): Promise<StorageDeleteOutcome>;
  copyObject(ref: ConnectionRef, input: StorageCopyInput): Promise<StoragePutResult>;
  /** A folder: an empty object whose key ends in a slash. */
  createPrefix(ref: ConnectionRef, input: { bucket: string; prefix: string }): Promise<void>;
  /** Replaces the object's tag set; an empty record clears it. */
  putTags(
    ref: ConnectionRef,
    input: { bucket: string; key: string; tags: Readonly<Record<string, string>> },
  ): Promise<void>;

  /** Signed URLs; each is refused where `features` says `presign` is off. */
  presignPut(
    ref: ConnectionRef,
    input: { bucket: string; key: string; contentType?: string | undefined; overwrite: boolean },
  ): Promise<string>;
  presignPart(
    ref: ConnectionRef,
    input: { bucket: string; key: string; uploadId: string; partNumber: number },
  ): Promise<string>;
  presignGet(ref: ConnectionRef, object: StorageObjectRef): Promise<string>;
}

const ports = new Map<string, ObjectStoragePort>();

/** Called once per provider at startup; a second call for the same id replaces the first. */
export function registerObjectStorage(provider: string, port: ObjectStoragePort): void {
  ports.set(provider, port);
}

export function objectStorageFor(ref: ConnectionRef): ObjectStoragePort {
  const port = ports.get(ref.provider);
  if (!port) throw new ObjectStorageUnavailableError(ref.provider);
  return port;
}
