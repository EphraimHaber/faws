import type { S3Scope } from "@faws/contracts";

/**
 * The part of a query key that says which storage system answered.
 *
 * Every S3 query has to carry it. A key built from the bucket and the object
 * alone collides across endpoints - the same bucket name and the same key
 * exist on AWS and on a MinIO in the next rack, and the cache would hand one
 * system's bytes to a pane showing the other.
 */
export function scopeKey(scope: S3Scope): [string, string, string] {
  return [scope.profile, scope.region, scope.connectionId ?? ""];
}
