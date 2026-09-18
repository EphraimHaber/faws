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

/** One object, optionally a particular version of it. */
export const s3ObjectRefSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1).max(1024),
  versionId: z.string().optional(),
});

export type S3ObjectRef = z.infer<typeof s3ObjectRefSchema>;
