/**
 * The one base class every expected failure extends.
 *
 * A `DomainError` is a failure the person in front of the app can act on: a
 * missing profile, a refused certificate, a provider that is switched off. It
 * says how the transport should classify it (`status`) and what the renderer
 * needs to explain it (`toCause()`), so the tRPC layer maps every one of them
 * the same way and a new error never needs a new branch there.
 *
 * Anything that is not a `DomainError` is a bug and reaches the wire as an
 * internal error.
 */

/** The transport classes a domain failure can fall into, named as tRPC names them. */
export type DomainErrorStatus =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "PRECONDITION_FAILED";

/** What reaches the renderer: a stable `kind` to switch on, plus the error's own facts. */
export interface ErrorCause {
  readonly kind: string;
  readonly message: string;
  readonly [detail: string]: unknown;
}

export abstract class DomainError extends Error {
  /** Stable across releases; the renderer switches on it. */
  abstract readonly kind: string;
  abstract readonly status: DomainErrorStatus;

  /** The facts beyond the message that the renderer needs to explain this failure. */
  protected details(): Record<string, unknown> {
    return {};
  }

  toCause(): ErrorCause {
    const details = Object.fromEntries(
      Object.entries(this.details()).filter(([, value]) => value !== undefined),
    );
    return { ...details, kind: this.kind, message: this.message };
  }
}

/**
 * Raised when a guard refuses an operation.
 *
 * The reason is part of the message because the two switches fail
 * differently: one is "this build cannot write at all", the other is "it can
 * write, but this would destroy something". Telling them apart is what makes
 * the refusal actionable.
 */
export class ReadOnlyModeError extends DomainError {
  readonly kind = "ReadOnlyModeError";
  readonly status = "FORBIDDEN";
  readonly reason: "read-only" | "destructive";

  constructor(operation: string, reason: "read-only" | "destructive" = "read-only") {
    super(
      reason === "read-only"
        ? `Read-only mode is on; "${operation}" was blocked.`
        : `"${operation}" destroys data, and deletion is not armed for this session.`,
    );
    this.name = "ReadOnlyModeError";
    this.reason = reason;
  }

  protected override details() {
    return { reason: this.reason };
  }
}

/**
 * Raised when something asks a provider the user has switched off.
 *
 * A precondition rather than a permission: nothing is wrong with the request,
 * only with the moment, and the fix is one switch in Settings.
 */
export class ProviderDisabledError extends DomainError {
  readonly kind = "ProviderDisabledError";
  readonly status = "PRECONDITION_FAILED";
  readonly provider: string;

  constructor(provider: string, label: string = provider) {
    super(`${label} is switched off. Turn it on in Settings to use it.`);
    this.name = "ProviderDisabledError";
    this.provider = provider;
  }

  protected override details() {
    return { provider: this.provider };
  }
}

/**
 * Raised when a connection names a provider that serves no object storage.
 *
 * A stale link or a provider missing from this build lands here, and the fix
 * is another connection rather than a retry.
 */
export class ObjectStorageUnavailableError extends DomainError {
  readonly kind = "ObjectStorageUnavailableError";
  readonly status = "NOT_FOUND";
  readonly provider: string;

  constructor(provider: string) {
    super(`"${provider}" does not offer object storage.`);
    this.name = "ObjectStorageUnavailableError";
    this.provider = provider;
  }

  protected override details() {
    return { provider: this.provider };
  }
}
