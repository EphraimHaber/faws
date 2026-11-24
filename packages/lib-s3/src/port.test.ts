import { GetBucketLocationCommand, S3Client } from "@aws-sdk/client-s3";
import { s3ConnectionInputSchema } from "@faws/contracts";
import type { ConnectionRef } from "@faws/kit";
import {
  describeObjectStoragePort,
  type ObjectStorageFixture,
  type ObjectStorageHarness,
} from "@faws/kit/testing";
import { afterAll } from "vitest";

import { getConnection, saveConnection } from "./endpoint/connections.ts";
import { endpointClient } from "./endpoint/endpointClient.ts";
import {
  createMemoryConnectionStore,
  createMemoryCredentialStore,
  registerConnectionStores,
} from "./endpoint/store.ts";
import { installMemoryS3 } from "./memoryS3.ts";
import { createS3ObjectStoragePort } from "./port.ts";

let restore: (() => void) | null = null;

afterAll(() => restore?.());

/** The fixture as one bucket in Ireland and an empty one in the default region. */
function seed(fixture: ObjectStorageFixture): void {
  restore?.();
  restore = installMemoryS3({
    buckets: [
      { name: fixture.bucket, region: "eu-west-1", objects: fixture.objects },
      { name: fixture.otherBucket, region: "us-east-1" },
    ],
  });
}

/** The region half of an AWS style `profile@region` id. */
function regionOf(ref: ConnectionRef): string {
  return ref.id.slice(ref.id.lastIndexOf("@") + 1);
}

/**
 * Resolved the way AWS is: the ref names a profile and region, and a bucket
 * call goes to a client in the bucket's own region.
 */
function awsStyle(fixture: ObjectStorageFixture): ObjectStorageHarness {
  seed(fixture);
  const clients = new Map<string, S3Client>();
  const clientIn = (region: string) => {
    const existing = clients.get(region);
    if (existing) return existing;
    const client = new S3Client({
      region,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    clients.set(region, client);
    return client;
  };
  const bucketRegion = async (ref: ConnectionRef, bucket: string) => {
    const page = await clientIn(regionOf(ref)).send(
      new GetBucketLocationCommand({ Bucket: bucket }),
    );
    return page.LocationConstraint ?? "us-east-1";
  };

  const port = createS3ObjectStoragePort(
    async (ref, bucket) => clientIn(bucket ? await bucketRegion(ref, bucket) : regionOf(ref)),
    { bucketRegion },
  );
  return { port, ref: { provider: "aws", id: "default@eu-west-1" } };
}

/** Resolved the way a saved endpoint is: through its stored record and credential. */
async function endpointStyle(fixture: ObjectStorageFixture): Promise<ObjectStorageHarness> {
  seed(fixture);
  registerConnectionStores({
    connections: createMemoryConnectionStore(),
    credentials: createMemoryCredentialStore(),
  });
  const connection = await saveConnection(
    s3ConnectionInputSchema.parse({
      name: "MinIO",
      endpoint: "http://minio.test:9000",
      credentialMode: "stored",
      accessKeyId: "minio",
      secretAccessKey: "minio-secret",
    }),
  );

  const port = createS3ObjectStoragePort(
    async (ref) => endpointClient(await getConnection(ref.id)),
    {
      features: async (ref) => ({
        bucketRegions: false,
        storageMetrics: false,
        presign: (await getConnection(ref.id)).features.presign,
      }),
      bucketRegion: async (ref) => (await getConnection(ref.id)).region,
    },
  );
  return { port, ref: { provider: "s3", id: connection.id } };
}

describeObjectStoragePort("S3 through an AWS profile", awsStyle);
describeObjectStoragePort("S3 through a saved endpoint", endpointStyle);
