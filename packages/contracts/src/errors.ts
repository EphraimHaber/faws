/** Thrown when a named AWS profile isn't present in the local shared config. */
export class ProfileNotFoundError extends Error {
  readonly profile: string | undefined;

  constructor(message: string, profile?: string) {
    super(message);
    this.name = "ProfileNotFoundError";
    this.profile = profile;
  }
}

/** Wraps a failed AWS SDK call so the transport layer can map it to a 4xx. */
export class AwsRequestError extends Error {
  readonly code: string | undefined;
  readonly service: string | undefined;

  constructor(message: string, options?: { code?: string; service?: string }) {
    super(message);
    this.name = "AwsRequestError";
    this.code = options?.code;
    this.service = options?.service;
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
export class ReadOnlyModeError extends Error {
  constructor(operation: string, reason: "read-only" | "destructive" = "read-only") {
    super(
      reason === "read-only"
        ? `Read-only mode is on; "${operation}" was blocked.`
        : `"${operation}" destroys data, and deletion is not armed for this session.`,
    );
    this.name = "ReadOnlyModeError";
  }
}

/** Thrown when a scope names an S3 connection that is no longer stored. */
export class ConnectionNotFoundError extends Error {
  readonly connectionId: string;

  constructor(connectionId: string) {
    super(`That S3 connection no longer exists.`);
    this.name = "ConnectionNotFoundError";
    this.connectionId = connectionId;
  }
}

/**
 * Thrown when an endpoint's certificate is refused.
 *
 * Separate from a request failure because the fix is different in kind: no
 * credential, permission or bucket name changes the answer, and the thing that
 * would - trusting a CA or a certificate - is a decision, so the message has
 * to reach the person who can make it rather than read as "S3 is down".
 */
export class EndpointTrustError extends Error {
  readonly endpoint: string;
  readonly reason: string;

  constructor(endpoint: string, reason: string) {
    super(`The certificate at ${endpoint} was not trusted: ${reason}`);
    this.name = "EndpointTrustError";
    this.endpoint = endpoint;
    this.reason = reason;
  }
}
