import {
  GetBucketAclCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { StorageBucketConfig, StorageBucketConfigField } from "@faws/kit";

import { callS3 } from "../call.ts";

/**
 * Everything the properties pane shows, read field by field.
 *
 * Each of these is a separate API call with its own permission, and several
 * answer with a fault when the thing simply is not configured: a bucket with
 * no policy raises `NoSuchBucketPolicy` rather than returning nothing. So no
 * single failure is allowed to blank the pane - what could not be read is
 * reported as such, because "you cannot see this" and "this is not set" are
 * different answers and both are useful.
 */
export async function bucketConfig(client: S3Client, bucket: string): Promise<StorageBucketConfig> {
  const denied: StorageBucketConfigField[] = [];

  const read = async <T>(
    field: StorageBucketConfigField,
    run: () => Promise<T>,
  ): Promise<T | null> => {
    try {
      return await run();
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      // A missing configuration is an answer; a refused read is not.
      if (/AccessDenied|Forbidden|NotImplemented/i.test(name)) denied.push(field);
      return null;
    }
  };

  const [versioning, encryption, publicAccess, policy, lifecycle, tags, owner] = await Promise.all([
    read("versioning", () =>
      callS3(() => client.send(new GetBucketVersioningCommand({ Bucket: bucket }))),
    ),
    read("encryption", () =>
      callS3(() => client.send(new GetBucketEncryptionCommand({ Bucket: bucket }))),
    ),
    read("publicAccessBlock", () =>
      callS3(() => client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }))),
    ),
    read("policy", () => callS3(() => client.send(new GetBucketPolicyCommand({ Bucket: bucket })))),
    read("lifecycle", () =>
      callS3(() => client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))),
    ),
    read("tags", () => callS3(() => client.send(new GetBucketTaggingCommand({ Bucket: bucket })))),
    read("owner", () => callS3(() => client.send(new GetBucketAclCommand({ Bucket: bucket })))),
  ]);

  const rule =
    encryption?.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault;
  const block = publicAccess?.PublicAccessBlockConfiguration;

  return {
    versioning:
      versioning?.Status === "Enabled"
        ? "Enabled"
        : versioning?.Status === "Suspended"
          ? "Suspended"
          : "Disabled",
    mfaDelete: versioning?.MFADelete === "Enabled",
    encryption: rule
      ? { algorithm: rule.SSEAlgorithm ?? "unknown", kmsKeyId: rule.KMSMasterKeyID ?? null }
      : null,
    publicAccessBlock: block
      ? {
          blockPublicAcls: block.BlockPublicAcls ?? false,
          ignorePublicAcls: block.IgnorePublicAcls ?? false,
          blockPublicPolicy: block.BlockPublicPolicy ?? false,
          restrictPublicBuckets: block.RestrictPublicBuckets ?? false,
        }
      : null,
    policyJson: policy?.Policy ?? null,
    lifecycleRules: (lifecycle?.Rules ?? []).map((entry) => ({
      id: entry.ID ?? "",
      status: entry.Status ?? "Unknown",
      prefix: entry.Filter && "Prefix" in entry.Filter ? (entry.Filter.Prefix ?? "") : "",
      expiresAfterDays: entry.Expiration?.Days ?? null,
      transitions: (entry.Transitions ?? []).map((transition) => ({
        storageClass: transition.StorageClass ?? "",
        afterDays: transition.Days ?? null,
      })),
    })),
    tags: Object.fromEntries((tags?.TagSet ?? []).map((tag) => [tag.Key ?? "", tag.Value ?? ""])),
    ownerName: owner?.Owner?.DisplayName ?? owner?.Owner?.ID ?? null,
    denied,
  };
}
