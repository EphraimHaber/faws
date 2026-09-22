/**
 * Input schemas shared by the server routers and the client forms.
 *
 * One definition per operation: the tRPC procedure validates with it, and the
 * form validates with the same object, so a constraint can't be enforced on
 * one side and forgotten on the other.
 */
import { z } from "zod";

export const awsScopeSchema = z.object({
  profile: z.string(),
  region: z.string().min(1),
});

/**
 * ECS rejects an update that changes nothing, so at least one of the three
 * fields has to be present — checked here rather than in either caller.
 */
export const updateServiceSchema = z
  .object({
    cluster: z.string().min(1),
    service: z.string().min(1),
    desiredCount: z.number().int().min(0).max(5000).optional(),
    taskDefinition: z.string().min(1).optional(),
    forceNewDeployment: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.desiredCount !== undefined ||
      input.taskDefinition !== undefined ||
      input.forceNewDeployment === true,
    { message: "Change the desired count, the task definition, or force a new deployment." },
  );

export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

/**
 * What the update-service form collects.
 *
 * Separate from `updateServiceSchema` for the reason `exec.ts` keeps its
 * session forms separate from the handshake: this is what a person types,
 * while that is what the server is handed. The wire shape carries the cluster
 * and the service, which the form does not edit, and its "something must
 * change" rule is checked against a payload where the untouched fields have
 * already been dropped - ECS reads an omitted field as "leave it alone".
 *
 * A factory rather than a constant, because "something must change" can only
 * be judged against the values the service currently has, and those are not
 * known until one is being edited.
 */
export function updateServiceFormSchema(current: {
  readonly desiredCount: number;
  readonly taskDefinition: string;
}) {
  return z
    .object({
      desiredCount: z.coerce.number().int().min(0).max(5000),
      taskDefinition: z.string().min(1),
      forceNewDeployment: z.boolean().default(false),
    })
    .refine(
      (values) =>
        values.desiredCount !== current.desiredCount ||
        values.taskDefinition !== current.taskDefinition ||
        values.forceNewDeployment,
      { message: "Change the desired count, the task definition, or force a new deployment." },
    );
}

export type UpdateServiceFormSchema = ReturnType<typeof updateServiceFormSchema>;
export type UpdateServiceFormInput = z.input<UpdateServiceFormSchema>;
export type UpdateServiceFormValues = z.output<UpdateServiceFormSchema>;

export const stopTaskSchema = z.object({
  cluster: z.string().min(1),
  taskId: z.string().min(1),
  reason: z.string().max(255).optional(),
});

export type StopTaskInput = z.infer<typeof stopTaskSchema>;

/**
 * One page of an object listing.
 *
 * `cursor` carries S3's own continuation token untouched, under the name the
 * infinite query helper looks for when it threads one page into the next. The
 * page size is capped at the 1000 the API allows and defaults well below it: a
 * shorter first page is a faster first row.
 */
export const s3ListObjectsSchema = z.object({
  bucket: z.string().min(1),
  prefix: z.string().max(1024).default(""),
  /**
   * Empty means no delimiter, which lists every key under the prefix rather
   * than stopping at the next slash.
   */
  delimiter: z.enum(["/", ""]).default("/"),
  maxKeys: z.number().int().min(1).max(1000).default(200),
  cursor: z.string().nullish(),
});

export type S3ListObjectsInput = z.infer<typeof s3ListObjectsSchema>;

/** S3's own ceiling on a key, in characters. */
const s3KeyField = z.string().min(1).max(1024);

/** One object, optionally a particular version of it. */
export const s3ObjectRefSchema = z.object({
  bucket: z.string().min(1),
  key: s3KeyField,
  versionId: z.string().optional(),
});

export type S3ObjectRef = z.infer<typeof s3ObjectRefSchema>;

/**
 * Deleting objects.
 *
 * Anything past a single object requires the bucket name typed back, checked
 * here rather than only in the dialog: the rule then holds for a caller that
 * never rendered one.
 */
export const s3DeleteObjectsSchema = z
  .object({
    bucket: z.string().min(1),
    objects: z
      .array(z.object({ key: s3KeyField, versionId: z.string().optional() }))
      .min(1)
      // The API itself refuses more than this in one call.
      .max(1000),
    confirm: z.string().default(""),
  })
  .refine((input) => input.objects.length === 1 || input.confirm === input.bucket, {
    message: "Type the bucket name to confirm deleting more than one object.",
    path: ["confirm"],
  });

export type S3DeleteObjectsInput = z.infer<typeof s3DeleteObjectsSchema>;

export const s3CopyObjectSchema = z
  .object({
    sourceBucket: z.string().min(1),
    sourceKey: s3KeyField,
    sourceVersionId: z.string().optional(),
    destBucket: z.string().min(1),
    destKey: s3KeyField,
    /** A move is a copy followed by a delete, never one operation. */
    deleteSource: z.boolean().default(false),
    overwrite: z.boolean().default(false),
  })
  .refine((input) => input.sourceBucket !== input.destBucket || input.sourceKey !== input.destKey, {
    message: "The destination is the same object as the source.",
    path: ["destKey"],
  });

export type S3CopyObjectInput = z.infer<typeof s3CopyObjectSchema>;

export const s3CreatePrefixSchema = z.object({
  bucket: z.string().min(1),
  prefix: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => !value.startsWith("/"), {
      message: "A prefix cannot start with a slash.",
    }),
});

export type S3CreatePrefixInput = z.infer<typeof s3CreatePrefixSchema>;

export const s3PutTagsSchema = z.object({
  bucket: z.string().min(1),
  key: s3KeyField,
  // Ten is the service's own ceiling; the editor counts against it.
  tags: z
    .record(z.string().min(1).max(128), z.string().max(256))
    .refine((tags) => Object.keys(tags).length <= 10, {
      message: "An object carries at most ten tags.",
    }),
});

export type S3PutTagsInput = z.infer<typeof s3PutTagsSchema>;

/**
 * Opening an upload.
 *
 * `proxy` sends the bytes through this server, which keeps every credential on
 * that side. `presigned` hands the browser a signed URL and lets it write to
 * S3 directly: faster and free of the extra hop, at the cost of a bearer grant
 * living in the renderer and a bucket CORS policy that allows this origin.
 */
export const s3CreateUploadSchema = z.object({
  bucket: z.string().min(1),
  key: s3KeyField,
  size: z.number().int().min(0),
  contentType: z.string().default("application/octet-stream"),
  overwrite: z.boolean().default(false),
  transport: z.enum(["proxy", "presigned"]).default("proxy"),
});

export type S3CreateUploadInput = z.infer<typeof s3CreateUploadSchema>;

export const s3CompleteUploadSchema = z.object({
  uploadToken: z.string().min(1),
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1) }))
    .min(1),
});

export const s3AbortUploadSchema = z.object({ uploadToken: z.string().min(1) });

/** A signed URL for one part of an open presigned upload. */
export const s3PresignPartSchema = z.object({
  uploadToken: z.string().min(1),
  partNumber: z.number().int().min(1).max(10_000),
});
