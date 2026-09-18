import type { S3Scope } from "@faws/contracts";

import { resolveServerOrigin } from "./apiUrl.ts";

export interface ObjectRef {
  readonly bucket: string;
  readonly key: string;
  readonly versionId?: string;
}

/**
 * Where an object's bytes are served from.
 *
 * A plain same origin URL with no credential in it, which is the point: it can
 * be handed to `<img>`, `<video>` or a download without the renderer ever
 * holding anything that grants access to the bucket.
 */
export function objectUrl(
  scope: S3Scope,
  ref: ObjectRef,
  options: { disposition?: "inline" | "attachment"; raw?: boolean } = {},
): string {
  const url = new URL("/s3/object", resolveServerOrigin());
  url.searchParams.set("profile", scope.profile);
  url.searchParams.set("region", scope.region);
  if (scope.connectionId) url.searchParams.set("connectionId", scope.connectionId);
  url.searchParams.set("bucket", ref.bucket);
  url.searchParams.set("key", ref.key);
  if (ref.versionId) url.searchParams.set("versionId", ref.versionId);
  if (options.disposition) url.searchParams.set("disposition", options.disposition);
  if (options.raw) url.searchParams.set("raw", "1");
  return url.toString();
}

export interface RangeResult {
  readonly bytes: Uint8Array;
  /** The object's full length, which a partial response reports separately. */
  readonly totalSize: number | null;
  readonly contentType: string | null;
}

/**
 * The first `length` bytes of an object.
 *
 * What makes a huge object openable: a viewer reads a slice and says so,
 * rather than pulling gigabytes into a string to show the first screen.
 */
export async function fetchRange(
  scope: S3Scope,
  ref: ObjectRef,
  start: number,
  length: number,
  options: { raw?: boolean; signal?: AbortSignal } = {},
): Promise<RangeResult> {
  const end = start + length - 1;
  const response = await fetch(objectUrl(scope, ref, options.raw ? { raw: true } : {}), {
    headers: { range: `bytes=${start}-${end}` },
    signal: options.signal ?? null,
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(await errorMessage(response));
  }

  const buffer = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    totalSize: totalFromContentRange(response.headers.get("content-range")),
    contentType: response.headers.get("content-type"),
  };
}

/** The whole object as text, for the cases the size gate has allowed. */
export async function fetchText(
  scope: S3Scope,
  ref: ObjectRef,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const response = await fetch(objectUrl(scope, ref), { signal: options.signal ?? null });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.text();
}

/** Hands the object to the browser's own download machinery. */
export function downloadObject(scope: S3Scope, ref: ObjectRef): void {
  const anchor = document.createElement("a");
  anchor.href = objectUrl(scope, ref, { disposition: "attachment" });
  anchor.rel = "noopener";
  anchor.download = ref.key.slice(ref.key.lastIndexOf("/") + 1);
  anchor.click();
}

/** "bytes 0-255/4096" -> 4096, which is the only place the full size appears. */
function totalFromContentRange(header: string | null): number | null {
  const total = header?.split("/")[1];
  if (!total || total === "*") return null;
  const parsed = Number(total);
  return Number.isFinite(parsed) ? parsed : null;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // A non JSON body means the failure came from somewhere other than the
    // route's own error path; the status is all there is to report.
  }
  return `${response.status} ${response.statusText}`;
}
