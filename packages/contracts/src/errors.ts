import { DomainError } from "@faws/kit";

export { ReadOnlyModeError } from "@faws/kit";

/** Thrown when a named AWS profile isn't present in the local shared config. */
export class ProfileNotFoundError extends DomainError {
  readonly kind = "ProfileNotFoundError";
  readonly status = "NOT_FOUND";
  readonly profile: string | undefined;

  constructor(message: string, profile?: string) {
    super(message);
    this.name = "ProfileNotFoundError";
    this.profile = profile;
  }

  protected override details() {
    return { profile: this.profile };
  }
}

/** Wraps a failed AWS SDK call so the transport layer can map it to a 4xx. */
export class AwsRequestError extends DomainError {
  readonly kind = "AwsRequestError";
  readonly status = "BAD_REQUEST";
  readonly code: string | undefined;
  readonly service: string | undefined;

  constructor(message: string, options?: { code?: string; service?: string }) {
    super(message);
    this.name = "AwsRequestError";
    this.code = options?.code;
    this.service = options?.service;
  }

  protected override details() {
    return { code: this.code, service: this.service };
  }
}

/** Thrown when a scope names an S3 connection that is no longer stored. */
export class ConnectionNotFoundError extends DomainError {
  readonly kind = "ConnectionNotFoundError";
  readonly status = "NOT_FOUND";
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
export class EndpointTrustError extends DomainError {
  readonly kind = "EndpointTrustError";
  readonly status = "BAD_REQUEST";
  readonly endpoint: string;
  readonly reason: string;

  constructor(endpoint: string, reason: string) {
    super(`The certificate at ${endpoint} was not trusted: ${reason}`);
    this.name = "EndpointTrustError";
    this.endpoint = endpoint;
    this.reason = reason;
  }

  protected override details() {
    return { endpoint: this.endpoint, reason: this.reason };
  }
}
