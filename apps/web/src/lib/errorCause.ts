import type { ErrorCause } from "@faws/kit";

/**
 * The server's description of an expected failure, when there is one.
 *
 * Every `DomainError` reaches the client as `error.data.cause`; anything else
 * (a network failure, a bug) has none, and callers fall back to the message.
 */
export function errorCause(error: unknown): ErrorCause | null {
  if (typeof error !== "object" || error === null) return null;
  const cause = (error as { data?: { cause?: unknown } }).data?.cause;
  if (typeof cause !== "object" || cause === null) return null;
  const { kind, message } = cause as { kind?: unknown; message?: unknown };
  return typeof kind === "string" && typeof message === "string" ? (cause as ErrorCause) : null;
}

/** Where a refused certificate was presented, when the failure says. */
export function untrustedEndpoint(error: unknown): { host: string; port: number } | null {
  const cause = errorCause(error);
  if (cause?.kind !== "EndpointTrustError") return null;
  try {
    const url = new URL(String(cause["endpoint"]));
    return { host: url.hostname, port: Number(url.port || (url.protocol === "http:" ? 80 : 443)) };
  } catch {
    return { host: "", port: 443 };
  }
}

/** The kube context whose login has lapsed, when that is why a read failed. */
export interface ExpiredKubeLogin {
  readonly context: string;
  readonly server: string | null;
  readonly user: string;
}

export function expiredKubeLogin(error: unknown): ExpiredKubeLogin | null {
  const cause = errorCause(error);
  if (cause?.kind !== "KubeUnauthorized" || typeof cause["context"] !== "string") return null;
  return {
    context: cause["context"],
    server: typeof cause["server"] === "string" ? cause["server"] : null,
    user: typeof cause["user"] === "string" ? cause["user"] : "",
  };
}
