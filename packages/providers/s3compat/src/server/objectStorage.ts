/**
 * A saved endpoint's object storage.
 *
 * A connection is the endpoint's record id. One endpoint serves every bucket
 * it has from one URL and one configured region, so every call goes through
 * the same client, and the record alone says what the endpoint can do.
 */
import { s3EndpointFeatures } from "@faws/contracts";
import { bucketStorageMetrics } from "@faws/core";
import { registerObjectStorage } from "@faws/kit/server";
import { createS3ObjectStoragePort, endpointClient, getConnection } from "@faws/lib-s3";

export const s3compatObjectStorage = createS3ObjectStoragePort(
  async (ref) => endpointClient(await getConnection(ref.id)),
  {
    features: async (ref) => s3EndpointFeatures(await getConnection(ref.id)),
    // Asking an endpoint where a bucket lives either answers with its own
    // configured region or is not implemented at all.
    bucketRegion: async (ref) => (await getConnection(ref.id)).region,
    // Only an endpoint fronting real AWS buckets has CloudWatch behind it, and
    // it reaches CloudWatch with the profile it signs with, or the default
    // credential chain when it signs some other way.
    storageMetrics: async (ref, bucket, days) => {
      const connection = await getConnection(ref.id);
      const profile =
        connection.credentials.mode === "aws-profile" ? connection.credentials.profile : "";
      return bucketStorageMetrics(profile, connection.region, bucket, { days });
    },
  },
);

export function registerS3compatObjectStorage(): void {
  registerObjectStorage("s3", s3compatObjectStorage);
}
