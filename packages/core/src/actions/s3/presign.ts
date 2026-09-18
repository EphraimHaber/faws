import {
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { S3Scope } from "@faws/contracts";
import { AwsRequestError } from "@faws/contracts";

import { callAws } from "../../clients.ts";
import { s3ClientForBucket } from "../../fetchers/s3/buckets.ts";
import { connectionFor } from "../../s3/connections.ts";
import { assertDestructive, assertMutable } from "../../readOnlyGuard.ts";

/**
 * How long a signed URL stays usable.
 *
 * Short, because the URL is the credential: anyone holding it can do what it
 * says until it expires, and nothing can revoke it in the meantime. Long
 * enough that a large upload over a slow line still finishes.
 */
export const PRESIGN_TTL_SECONDS = 15 * 60;

/**
 * Refuses to sign for an endpoint the browser cannot use.
 *
 * A signed URL is only worth anything if the renderer can reach the host it
 * names and trust its certificate, which on a private network is a separate
 * question from whether this process can. The connection says which it is, and
 * the proxy is the path that always works.
 */
async function assertPresignable(scope: S3Scope): Promise<void> {
  const connection = await connectionFor(scope);
  if (connection && !connection.features.presign) {
    throw new AwsRequestError(
      `Signed URLs are turned off for "${connection.name}"; uploads and downloads go through the proxy.`,
      { code: "PresignDisabled", service: "s3" },
    );
  }
}

/**
 * A URL the browser can write to directly.
 *
 * This is the opposite trade from the proxy: the bytes skip this process
 * entirely, which is faster and costs the server nothing, but the signature
 * is a bearer grant of the caller's own IAM rights that ends up in the
 * renderer. It also needs the bucket's own CORS policy to allow the app's
 * origin, which most buckets do not, so it is offered rather than assumed.
 */
export async function presignPutUrl(
  scope: S3Scope,
  input: { bucket: string; key: string; contentType?: string; overwrite: boolean },
): Promise<string> {
  await assertPresignable(scope);
  if (input.overwrite) assertDestructive("s3:PutObject (presigned overwrite)");
  else assertMutable("s3:PutObject (presigned)");

  const client = await s3ClientForBucket(scope, input.bucket);
  return sign(
    client,
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ...(input.contentType ? { ContentType: input.contentType } : {}),
      // The same conditional write the proxied path uses, carried in the
      // signature so it cannot be dropped by whoever holds the URL.
      ...(input.overwrite ? {} : { IfNoneMatch: "*" }),
    }),
  );
}

/** One part of a multipart upload, signed the same way. */
export async function presignUploadPartUrl(
  scope: S3Scope,
  input: { bucket: string; key: string; uploadId: string; partNumber: number },
): Promise<string> {
  await assertPresignable(scope);
  assertMutable("s3:UploadPart (presigned)");

  const client = await s3ClientForBucket(scope, input.bucket);
  return sign(
    client,
    new UploadPartCommand({
      Bucket: input.bucket,
      Key: input.key,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
    }),
  );
}

/**
 * A URL that reads an object, for sending to someone else.
 *
 * Reading in the app goes through the proxy; this exists for the case the
 * proxy cannot serve, which is handing the object to a person or a system
 * that is not this app.
 */
export async function presignGetUrl(
  scope: S3Scope,
  input: { bucket: string; key: string; versionId?: string | undefined },
): Promise<string> {
  await assertPresignable(scope);

  const client = await s3ClientForBucket(scope, input.bucket);
  return sign(
    client,
    new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ...(input.versionId ? { VersionId: input.versionId } : {}),
    }),
  );
}

type SignableCommand = PutObjectCommand | UploadPartCommand | GetObjectCommand;

/**
 * Signs one command.
 *
 * Whether a checksum ends up in the URL is decided by the client, which asks
 * for one only where the API requires it. Left on the default, the SDK
 * computes a CRC32 at signing time - over no body, because there is none yet -
 * and hoists it into the query, so S3 measures the real bytes against the
 * checksum of nothing and refuses every upload.
 */
function sign(client: S3Client, command: SignableCommand): Promise<string> {
  return callAws("s3", () =>
    // The presigner's parameter declares its optional fields without
    // `undefined`, which this workspace's stricter optionality does not
    // consider assignable; the commands themselves are what it wants.
    getSignedUrl(client, command as never, { expiresIn: PRESIGN_TTL_SECONDS }),
  );
}
