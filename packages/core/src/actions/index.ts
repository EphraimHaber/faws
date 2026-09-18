/**
 * Mutating operations, grouped by AWS service.
 *
 * Separate from `fetchers/` because every function here calls a guard before
 * it touches a client: keeping the two apart is what makes "this build cannot
 * change anything" a structural claim rather than a per handler promise.
 */
export * from "./s3/objects.ts";
