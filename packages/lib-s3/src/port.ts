/**
 * The S3 API as an object storage port.
 *
 * Everything that speaks S3 - AWS itself, MinIO, Ceph, a NAS - is served by
 * this one implementation. What differs between them is how a client is built
 * and what the endpoint can do beyond the object API, and the provider says
 * both: `resolveClient` turns its connection into a client, and the options
 * describe the rest.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { AwsRequestError } from "@faws/contracts";
import type { ConnectionRef, StorageFeatures, StorageMetricSeries } from "@faws/kit";
import type { ObjectStoragePort } from "@faws/kit/server";

import {
  abortMultipartUpload,
  completeMultipartUpload,
  copyObject,
  createMultipartUpload,
  createPrefix,
  deleteObjects,
  putObject,
  putObjectTags,
  uploadPart,
} from "./actions/objects.ts";
import {
  assertPresignable,
  presignGetUrl,
  presignPutUrl,
  presignUploadPartUrl,
} from "./actions/presign.ts";
import { bucketConfig } from "./fetchers/bucketConfig.ts";
import { bucketVersioning, listBuckets } from "./fetchers/buckets.ts";
import { getObjectStream, headObject, listObjectsPage } from "./fetchers/objects.ts";
import { scanPrefix } from "./fetchers/scan.ts";
import { listObjectVersions } from "./fetchers/versions.ts";

/**
 * A client for a connection.
 *
 * With `bucket` set the client is for calls against that bucket, which on AWS
 * means a client in the bucket's own region; without it, for calls that are
 * about no bucket in particular.
 */
export type ResolveS3Client = (ref: ConnectionRef, bucket?: string) => Promise<S3Client>;

export interface S3PortOptions {
  /** What the connection can do. Defaults to what the other options imply. */
  readonly features?: (ref: ConnectionRef) => Promise<StorageFeatures>;
  /** A bucket's home region. Defaults to the client's own region. */
  readonly bucketRegion?: (ref: ConnectionRef, bucket: string) => Promise<string>;
  /** Daily size and count, from wherever the provider publishes them. */
  readonly storageMetrics?: (
    ref: ConnectionRef,
    bucket: string,
    days: number,
  ) => Promise<StorageMetricSeries[]>;
}

export function createS3ObjectStoragePort(
  resolveClient: ResolveS3Client,
  options: S3PortOptions = {},
): ObjectStoragePort {
  const features =
    options.features ??
    (() =>
      Promise.resolve({
        bucketRegions: options.bucketRegion !== undefined,
        storageMetrics: options.storageMetrics !== undefined,
        presign: true,
      }));

  const presignable = async (ref: ConnectionRef) => assertPresignable(await features(ref));

  return {
    features,

    listBuckets: async (ref) => listBuckets(await resolveClient(ref)),

    bucketRegion: async (ref, bucket) =>
      options.bucketRegion
        ? options.bucketRegion(ref, bucket)
        : (await resolveClient(ref)).config.region(),

    bucketVersioning: async (ref, bucket) =>
      bucketVersioning(await resolveClient(ref, bucket), bucket),

    bucketConfig: async (ref, bucket) => bucketConfig(await resolveClient(ref, bucket), bucket),

    storageMetrics: async (ref, bucket, { days }) => {
      // Most S3 compatible endpoints have no metrics service behind them, and
      // asking one that does not know the bucket answers with an empty series
      // that reads like a bucket of nothing.
      if (!options.storageMetrics || !(await features(ref)).storageMetrics) {
        throw new AwsRequestError("This connection does not publish storage metrics.", {
          code: "NotImplemented",
          service: "s3",
        });
      }
      return options.storageMetrics(ref, bucket, days);
    },

    listObjects: async (ref, input) =>
      listObjectsPage(await resolveClient(ref, input.bucket), input),

    listVersions: async (ref, input) =>
      listObjectVersions(await resolveClient(ref, input.bucket), input),

    head: async (ref, object) => headObject(await resolveClient(ref, object.bucket), object),

    openRead: async (ref, object, readOptions = {}) =>
      getObjectStream(await resolveClient(ref, object.bucket), object, readOptions),

    scan: async function* (ref, input, signal) {
      yield* scanPrefix(await resolveClient(ref, input.bucket), input, signal);
    },

    putObject: async (ref, input) => putObject(await resolveClient(ref, input.bucket), input),

    createUpload: async (ref, input) =>
      createMultipartUpload(await resolveClient(ref, input.bucket), input),

    uploadPart: async (ref, input) => uploadPart(await resolveClient(ref, input.bucket), input),

    completeUpload: async (ref, input) =>
      completeMultipartUpload(await resolveClient(ref, input.bucket), input),

    abortUpload: async (ref, input) =>
      abortMultipartUpload(await resolveClient(ref, input.bucket), input),

    deleteObjects: async (ref, input) =>
      deleteObjects(await resolveClient(ref, input.bucket), input),

    copyObject: async (ref, input) =>
      copyObject(
        await resolveClient(ref, input.destBucket),
        await resolveClient(ref, input.sourceBucket),
        input,
      ),

    createPrefix: async (ref, input) => createPrefix(await resolveClient(ref, input.bucket), input),

    putTags: async (ref, input) => putObjectTags(await resolveClient(ref, input.bucket), input),

    presignPut: async (ref, input) => {
      await presignable(ref);
      return presignPutUrl(await resolveClient(ref, input.bucket), input);
    },

    presignPart: async (ref, input) => {
      await presignable(ref);
      return presignUploadPartUrl(await resolveClient(ref, input.bucket), input);
    },

    presignGet: async (ref, object) => {
      await presignable(ref);
      return presignGetUrl(await resolveClient(ref, object.bucket), object);
    },
  };
}
